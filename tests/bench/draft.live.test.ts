import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { describe, it } from "vitest";
import { draftDirectCampaign } from "@/lib/launch/gig-draft";
import { llmCompleteJson } from "@/lib/llm/complete";
import { composeDirectBody, composerFromDraft, type ComposerState, type Draft } from "@/lib/launch/composer";
import { compileDirectCampaign, directCampaignSchema } from "@/lib/launch/direct-campaign";
import { wordsOnly, MAX_INTENT_CHARS } from "@/lib/launch/hand-over-text";
import { parseCandidates, pointLane, pool, usd } from "./lib/models";

/**
 * SAGE BENCH · DRAFT — what a team hands Sage → the job card → a plan that can launch.
 *
 * Every step is production's own code:
 * - the drafter (gig-draft.ts), on the DRAFT lane;
 * - the card mapping (composerFromDraft);
 * - the body the Launch button sends (composeDirectBody);
 * - the server's schema and the deterministic compiler.
 *
 * The founder's taps (the pay, the people) come from the scenario. Nothing is mocked except the network
 * read of a handed-over link: the scenario carries the text Sage would have read there. The reader is
 * measured on its own (reader.live.test.ts).
 *
 *   BENCH=1 BENCH_MODELS=anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5 \
 *     [BENCH_LIMIT=20] [BENCH_ONLY=software-bugfix,grants-milestones] [BENCH_RUN=name] \
 *     npx vitest run tests/bench/draft.live
 *
 * Writes tests/bench/results/<run>/draft-<candidate>.json and prints a summary per candidate.
 */
interface Scenario {
  id: string;
  category: string;
  persona: string;
  inputMode: string;
  input: string;
  sourceUrl: string | null;
  sourceText: string | null;
  founderTaps: { amountUsd: number; people: number; inviteOnly: boolean };
  expect: {
    shouldRefuse: boolean;
    refuseWhy: string | null;
    kind: "gig" | "grant";
    milestones: number;
    proofKind: string;
    mustCarry: string[];
    verifiability: string;
    pitfalls: string[];
  };
}


/** One scenario's outcome on one candidate. */
interface Row {
  id: string;
  category: string;
  inputMode: string;
  expect: Scenario["expect"];
  status: string;
  ms: number;
  error?: string;
  usage?: { prompt: number; completion: number; calls: number; finish: (string | null)[]; repaired: number };
  cost?: number;
  draft?: Draft;
  notes?: string[];
  kindMatch?: boolean;
  milestoneMatch?: boolean;
  proof?: string;
  drafted?: string[];
  totalBase?: string;
}

/**
 * The proof a drafted milestone really asks for: a platform proof (5 Nov 2026) is named by what it checks,
 * so a merged-PR check counts as "github_pr_merged", a shared sheet as "document_or_sheet", and so on.
 */
function effectiveProof(m: Draft["milestones"][number]): string {
  const e = m.evidence as Record<string, unknown> & { kind: string; allowedHosts?: string[] };
  if (e.kind !== "artifact_url") return e.kind;
  const hosts = (e.allowedHosts ?? []).join(" ");
  if (e.prMerged) return "github_pr_merged";
  if (/docs\.google\.com/.test(hosts) || e.minRows) return "document_or_sheet";
  if (e.minDurationSeconds || /youtube|youtu\.be|vimeo|loom|tiktok/.test(hosts)) return "video_url";
  if (/(^|\s)(x|twitter)\.com|bsky\.app/.test(hosts) || (e.postedAfterStart && !e.minDurationSeconds)) return "social_post";
  return "artifact_url";
}

/** Proofs Sage can verify today (5 Nov 2026: the three base kinds plus the platform proofs). */
const VERIFIABLE = new Set(["artifact_url", "public_url", "onchain_tx", "github_pr_merged", "document_or_sheet", "video_url", "social_post"]);

/** How a drafted proof compares to the ideal one. */
function proofVerdict(expected: string, drafted: string[]): "exact" | "supported_alternative" | "unsupported_ideal" | "mismatch" {
  if (drafted.length === 0) return "mismatch";
  if (drafted.every((d) => d === expected)) return "exact";
  if (!VERIFIABLE.has(expected)) return "unsupported_ideal"; // the ideal proof is a kind Sage cannot verify yet
  // any link-to-the-work proof where another link-to-the-work proof was ideal is close; a page proof where
  // a tx was ideal (or the reverse) is a real mismatch
  const linkish = (k: string) => k !== "onchain_tx";
  return drafted.every((d) => linkish(d) && linkish(expected)) ? "supported_alternative" : "mismatch";
}

describe.skipIf(process.env.BENCH !== "1")("bench · draft", () => {
  it("drafts, maps and compiles every scenario on every candidate", async () => {
    const corpus = JSON.parse(readFileSync(process.env.BENCH_CORPUS || "tests/bench/corpus/draft-scenarios.json", "utf8")) as Scenario[];
    const only = process.env.BENCH_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
    const ids = process.env.BENCH_IDS?.split(",").map((s) => s.trim()).filter(Boolean);
    let scenarios = corpus.filter((s) => (!only || only.includes(s.category)) && (!ids || ids.includes(s.id)));
    const limit = Number(process.env.BENCH_LIMIT) || scenarios.length;
    scenarios = scenarios.slice(0, limit);
    const run = process.env.BENCH_RUN || new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const dir = `tests/bench/results/${run}`;
    mkdirSync(dir, { recursive: true });
    process.env.LLM_MAX_CONCURRENCY = process.env.LLM_MAX_CONCURRENCY || "8";

    for (const cand of parseCandidates(process.env.BENCH_MODELS, "anthropic:claude-haiku-5-5")) {
      pointLane("DRAFT", cand);
      const started = Date.now();
      const rows: Row[] = await pool(scenarios, Number(process.env.BENCH_CONCURRENCY) || 6, async (s): Promise<Row> => {
        const usage = { prompt: 0, completion: 0, calls: 0, finish: [] as (string | null)[], repaired: 0 };
        const t0 = Date.now();
        const row = { id: s.id, category: s.category, inputMode: s.inputMode, expect: s.expect };
        if (s.input.trim().length > MAX_INTENT_CHARS) {
          return { ...row, status: "too_long", ms: 0 };
        }
        const r = await draftDirectCampaign(
          { intent: s.input, source: s.sourceUrl && s.sourceText ? { url: s.sourceUrl, text: s.sourceText.slice(0, 6000) } : null },
          {
            // Production's own call (gig-draft.ts defaultComplete without its retry/fallback), so the
            // bench measures the MODEL, and records what it spent.
            complete: async ({ system, user, maxTokens }) => {
              const c = await llmCompleteJson({ system, user, maxTokens, temperature: 0.3, lane: "DRAFT", parsePolicy: "repair" });
              usage.prompt += c.promptTokens;
              usage.completion += c.completionTokens;
              usage.calls += 1;
              usage.finish.push(c.finishReason ?? null);
              if (c.repaired) usage.repaired += 1;
              return { json: c.json, model: c.model };
            },
          },
        ).catch((e) => ({ ok: false as const, error: `threw: ${e instanceof Error ? e.message : String(e)}` }));
        const ms = Date.now() - t0;
        const cost = usd(cand.model, usage.prompt, usage.completion);
        if (!r.ok) {
          return { ...row, status: s.expect.shouldRefuse ? "refused_or_failed" : "draft_failed", error: r.error, ms, usage, cost };
        }
        const d = r.draft as Draft;
        // THE FOUNDER'S TAPS, where the card left them open: the pay and the people from the scenario.
        const card = composerFromDraft(d, wordsOnly(s.input));
        const grant = card.tranches.length > 1;
        const state: ComposerState = {
          who: card.pay.who,
          slots: grant ? "1" : card.pay.slots === "1" && s.founderTaps.people > 1 ? String(s.founderTaps.people) : card.pay.slots,
          tranches: card.tranches.map((t, i) => ({
            ...t,
            amount: grant ? "" : t.amount || (i === 0 ? String(s.founderTaps.amountUsd) : ""),
            // the founder pastes a contract address when the check needs one and Sage couldn't know it
            toAddr: t.verify === "onchain" && !t.deploysContract && !/^0x[0-9a-fA-F]{40}$/.test(t.toAddr) ? `0x${"c".repeat(40)}` : t.toAddr,
            expectedText: t.verify === "page" && t.expectedText.trim().length < 3 ? "Sage bench proof" : t.expectedText,
          })),
          splitTotal: grant ? card.splitTotal || String(s.founderTaps.amountUsd) : "",
          currency: "USD",
          inviteOnly: card.inviteOnly || s.founderTaps.inviteOnly,
          why: card.why,
          title: card.title,
        };
        const body = composeDirectBody(state);
        const parsed = directCampaignSchema.safeParse(body);
        const drafted = d.milestones.map(effectiveProof);
        const base = {
          ...row,
          ms,
          usage,
          cost,
          draft: d,
          notes: r.notes,
          kindMatch: d.kind === s.expect.kind,
          milestoneMatch: d.milestones.length === (s.expect.kind === "grant" ? s.expect.milestones : 1) || (s.expect.kind === "gig" && d.kind === "gig"),
          proof: proofVerdict(s.expect.proofKind, drafted),
          drafted,
        };
        if (!parsed.success) {
          const i0 = parsed.error.issues[0];
          return { ...base, status: s.expect.shouldRefuse ? "should_have_refused" : "schema_refused", error: `${i0.path.join(".")}: ${i0.message}` };
        }
        const compiled = (() => {
          try {
            return compileDirectCampaign(parsed.data, `${parsed.data.kind}-bench${String(Math.random()).slice(2, 8)}`, null);
          } catch (e) {
            return { ok: false as const, error: `threw: ${e instanceof Error ? e.message : String(e)}` };
          }
        })();
        if (!compiled.ok) return { ...base, status: s.expect.shouldRefuse ? "should_have_refused" : "compile_failed", error: compiled.error };
        return { ...base, status: s.expect.shouldRefuse ? "should_have_refused" : "launchable", totalBase: String(compiled.totalBudgetBase) };
      });
      const n = rows.length;
      const by = (st: string) => rows.filter((r) => r.status === st).length;
      const launchable = by("launchable");
      const shouldLaunch = rows.filter((r) => !r.expect.shouldRefuse).length;
      const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
      const cost = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
      const summary = {
        candidate: cand.id,
        scenarios: n,
        launchable: `${launchable}/${shouldLaunch}`,
        draftFailed: by("draft_failed"),
        schemaRefused: by("schema_refused"),
        compileFailed: by("compile_failed"),
        shouldHaveRefused: by("should_have_refused"),
        kindMismatch: rows.filter((r) => r.kindMatch === false).length,
        proof: Object.fromEntries(["exact", "supported_alternative", "unsupported_ideal", "mismatch"].map((k) => [k, rows.filter((r) => r.proof === k).length])),
        p50ms: ms[Math.floor(n * 0.5)] ?? 0,
        p95ms: ms[Math.floor(n * 0.95)] ?? 0,
        costUsd: Number(cost.toFixed(4)),
        wallSeconds: Math.round((Date.now() - started) / 1000),
      };
      console.log(JSON.stringify(summary));
      const file = `${dir}/draft-${cand.id.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
      const prev = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { rows: { id: string }[] }).rows : [];
      const merged = [...prev.filter((p) => !rows.some((r) => r.id === p.id)), ...rows];
      writeFileSync(file, JSON.stringify({ summary, rows: merged }, null, 2));
    }
  }, 6 * 60 * 60 * 1000);
});
