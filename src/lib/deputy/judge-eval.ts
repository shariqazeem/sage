import "server-only";

/**
 * P-JUDGE — the payout-brain evaluation, driven through the EXACT production judgment path.
 *
 * The earlier live harness copied the brain-core logic into a script, which can drift and end up testing
 * itself. This module instead invokes the real `verifySubmission` (prompt → parse → enforceQuotes →
 * hardenBrief → the provenance-stamped brief) with an injected provider, and reaches the final decision
 * through the real pipeline gate `gateFromBrief` — so there is NO duplicated prompt, parsing, confidence
 * rule, injection handling, or autopay logic. A candidate model is promoted only when this eval, run
 * against the production code, shows zero wrong-autopay + intact provenance.
 *
 * Metric semantics (corrected): each fixture carries a PERMITTED outcome SET. `wrong-autopay` — a fixture
 * that autopaid when "autopay" is not permitted — is the catastrophic, zero-tolerance number. A result
 * outside the permitted set is a violation too. "Every genuine fixture must autopay" is NOT a rule:
 * genuine-but-weak evidence SHOULD review, so its permitted set is {review,hold}. honest-autopay is a
 * quality metric to maximize, reported separately.
 */
import { createHash } from "node:crypto";
import { verifySubmission, providerForModel, type LlmProvider } from "./brain";
import { gateFromBrief } from "./autopilot";
import type { BrainInput, DecisionBrief } from "./brain-core";

/** Bump when SYSTEM_PROMPT / the money-decision shape changes — recorded on every row for provenance. */
export const JUDGE_PROMPT_VERSION = "payout-v1";

export type JudgeOutcome = "autopay" | "review" | "hold";

export interface JudgeFixture {
  id: string;
  category: string;
  /** acceptable outcomes. "autopay" ∉ permitted ⇒ this fixture must NEVER autopay. */
  permitted: JudgeOutcome[];
  criteria: string[];
  note: string;
  evidenceOk: boolean;
  evidenceText: string;
  /** optional human note about the fixture (ignored by the runner). */
  about?: string;
  /**
   * A DOCUMENTED, DEFERRED gap this fixture probes (e.g. "entailment-veto"). A wrong-autopay or
   * out-of-set result on a known-gap fixture is TRACKED + reported (knownGapAutopays) but does NOT count
   * as a promotion hard-stop, because the fix is a separately-scheduled item — not a surprise regression.
   * Remove the tag when the fix lands, and it becomes a hard-stop again. Provenance faults are always hard.
   */
  knownGap?: string;
}

/**
 * The eval CAMPAIGN — a synthetic mandate that drives the REAL production gate. Testnet chainId so the
 * mainnet-arming conjunct is a no-op; autopilot mode + the real 0.85 threshold. This is the exact object
 * shape `gateFromBrief` reads, so the eval's decision is the pipeline's decision.
 */
const EVAL_CAMPAIGN = { autonomy: "autopilot", autopilotThreshold: 0.85, chainId: 59902 } as const;

/**
 * The production autopay decision for a brief — computed by the REAL `gateFromBrief` (the pipeline gate),
 * never a reimplementation. Exported so a unit test can prove the eval's classification IS the gate.
 */
export function judgeDecision(brief: DecisionBrief): { outcome: JudgeOutcome; autopayQualified: boolean } {
  const gate = gateFromBrief(brief, EVAL_CAMPAIGN, "pending", /* mainnetAutopilotEnabled */ true);
  if (gate.pay) return { outcome: "autopay", autopayQualified: true };
  return { outcome: brief.recommendation === "hold" ? "hold" : "review", autopayQualified: false };
}

export interface JudgeRow {
  fixtureId: string;
  category: string;
  permitted: JudgeOutcome[];
  requestedModel: string;
  actualModel: string | null;
  actualProvider: string | null;
  engine: "llm" | "heuristic";
  chain: "primary" | "fallback" | "heuristic";
  promptVersion: string;
  outcome: JudgeOutcome;
  autopayQualified: boolean;
  /** sha256 (16 hex) over the canonical DECISION — non-sensitive, reproducible, never raw page/note text. */
  decisionHash: string;
  latencyMs: number | null;
  costUsd: number | null;
  status: "ok" | "error";
  violation: string | null;
}

function decisionHash(brief: DecisionBrief): string {
  const canon = JSON.stringify({
    r: brief.recommendation,
    c: brief.confidence,
    rc: brief.reasonCode,
    hf: brief.fraudSignals.some((f) => f.severity === "high"),
    e: brief.engine,
    m: brief.model,
  });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

export interface JudgeMetrics {
  model: string;
  runs: number;
  fixtures: number;
  calls: number;
  /** autopay ∉ permitted — CATASTROPHIC, must be 0. */
  wrongAutopay: number;
  /** outcome ∉ permitted (a superset of wrongAutopay). */
  outsideSet: number;
  honestAutopay: number;
  honestAutopayTotal: number;
  falseHold: number;
  provenanceViolations: number;
  latencyMsAvg: number | null;
  costUsdTotal: number | null;
  /** fixtures whose outcome varied across the runs (money-decision variance). */
  unstableFixtures: number;
  /** wrong-autopays on DOCUMENTED, deferred known-gap fixtures (e.g. the entailment veto) — REPORTED for
   *  honesty, but NOT a promotion hard-stop until the fix lands. */
  knownGapAutopays: number;
  knownGapEvents: string[];
  /** every HARD-STOP violation string — a non-empty list means the eval FAILS (caller exits non-zero). */
  violations: string[];
}

/**
 * Run the battery for one model. `verifySubmission` is invoked with the injected provider and
 * `fallback: null` — a single deterministic model, no env fail-over — so `actualModel` provenance is
 * exact and a primary failure degrades to the honest heuristic (recorded), never a silent other model.
 */
export async function runJudgeEval(opts: {
  model: string;
  runs?: number;
  fixtures: JudgeFixture[];
  provider?: LlmProvider | null;
  log?: (line: string) => void;
}): Promise<{ rows: JudgeRow[]; metrics: JudgeMetrics }> {
  const runs = Math.max(1, opts.runs ?? 1);
  const log = opts.log ?? (() => {});
  const provider = opts.provider !== undefined ? opts.provider : providerForModel(opts.model);
  const rows: JudgeRow[] = [];
  const violations: string[] = []; // HARD stops → non-zero exit
  const knownGapEvents: string[] = []; // documented, deferred gaps → tracked + reported, not hard stops
  let knownGapAutopays = 0;
  const outcomesByFixture = new Map<string, JudgeOutcome[]>();
  const latencies: number[] = [];
  let costTotal = 0;
  let costSeen = false;

  for (const f of opts.fixtures) {
    for (let r = 0; r < runs; r++) {
      const input: BrainInput = {
        campaignTitle: "Sage paid product-testing mission",
        criteria: f.criteria,
        conditionType: "approval",
        note: f.note,
        wallet: `0x${"a".repeat(40)}`,
        evidenceUrl: "https://example.org/submission",
        evidenceText: f.evidenceText,
        evidenceOk: f.evidenceOk,
        contentSha256: null,
      };
      let brief: DecisionBrief;
      let status: "ok" | "error" = "ok";
      try {
        // REAL production path, single injected model, no env fallback.
        brief = await verifySubmission(input, { provider, fallback: null });
      } catch {
        // verifySubmission never throws by contract; guard defensively → a fail-closed heuristic hold.
        status = "error";
        brief = { criteria: [], fraudSignals: [], recommendation: "hold", reasonCode: "unknown", confidence: 0, summary: "", engine: "heuristic", model: null, provider: null, evidenceOk: f.evidenceOk, contentSha256: null, latencyMs: null, costUsd: null, x402PaymentTx: null };
      }

      const { outcome, autopayQualified } = judgeDecision(brief);

      // HARD faults (always a promotion stop): missing/mismatched provenance, or the production path threw.
      let hard: string | null = null;
      if (brief.engine === "llm") {
        if (!brief.model) hard = "missing_provenance";
        else if (provider && brief.model !== provider.model) hard = `model_mismatch(${brief.model}≠${provider.model})`;
      }
      if (!hard && status === "error") hard = "production_path_threw";
      const chain: JudgeRow["chain"] =
        brief.engine === "heuristic" ? "heuristic" : provider && brief.provider === provider.host ? "primary" : "fallback";

      // SOFT result faults: an autopay that isn't permitted (wrong-autopay), or any out-of-permitted-set
      // outcome. A soft fault on a KNOWN-GAP fixture is TRACKED + reported (not a hard stop); everywhere
      // else it is hard. Provenance/throw are hard regardless of a known-gap tag.
      const wrongAutopay = outcome === "autopay" && !f.permitted.includes("autopay");
      const soft = wrongAutopay ? "wrong_autopay" : !f.permitted.includes(outcome) ? `outside_set(${outcome})` : null;
      const softIsHard = !!soft && !f.knownGap;
      if (soft && f.knownGap) {
        knownGapEvents.push(`${f.id}: ${soft} [known-gap: ${f.knownGap}]`);
        if (wrongAutopay) knownGapAutopays++;
      }
      if (hard) violations.push(`${f.id}: ${hard}`);
      if (softIsHard) violations.push(`${f.id}: ${soft}`);
      const violation = hard ?? (softIsHard ? soft : soft ? `known_gap:${soft}` : null);

      if (brief.latencyMs != null) latencies.push(brief.latencyMs);
      if (brief.costUsd != null) { costTotal += brief.costUsd; costSeen = true; }

      rows.push({
        fixtureId: f.id, category: f.category, permitted: f.permitted, requestedModel: opts.model,
        actualModel: brief.model, actualProvider: brief.provider, engine: brief.engine, chain,
        promptVersion: JUDGE_PROMPT_VERSION, outcome, autopayQualified, decisionHash: decisionHash(brief),
        latencyMs: brief.latencyMs, costUsd: brief.costUsd, status, violation,
      });
      const arr = outcomesByFixture.get(f.id) ?? [];
      arr.push(outcome);
      outcomesByFixture.set(f.id, arr);
      log(`  ${f.id} run${r + 1}/${runs}: ${outcome}${violation ? "  ⚠ " + violation : ""}  [${brief.model ?? brief.engine}]`);
    }
  }

  // metrics
  let honestAutopay = 0, honestTotal = 0, falseHold = 0, provenanceViolations = 0, unstable = 0;
  for (const f of opts.fixtures) {
    const outs = outcomesByFixture.get(f.id) ?? [];
    if (new Set(outs).size > 1) unstable++;
    if (f.permitted.includes("autopay")) {
      honestTotal++;
      if (outs.includes("autopay")) honestAutopay++;
      else falseHold++;
    }
  }
  for (const row of rows) if (row.violation === "missing_provenance" || /model_mismatch/.test(row.violation ?? "")) provenanceViolations++;

  const metrics: JudgeMetrics = {
    model: opts.model, runs, fixtures: opts.fixtures.length, calls: rows.length,
    wrongAutopay: rows.filter((r) => r.violation === "wrong_autopay").length,
    outsideSet: rows.filter((r) => r.violation && r.violation.startsWith("outside_set")).length + rows.filter((r) => r.violation === "wrong_autopay").length,
    honestAutopay, honestAutopayTotal: honestTotal, falseHold, provenanceViolations,
    latencyMsAvg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    costUsdTotal: costSeen ? Number(costTotal.toFixed(6)) : null,
    unstableFixtures: unstable, knownGapAutopays, knownGapEvents, violations,
  };
  return { rows, metrics };
}
