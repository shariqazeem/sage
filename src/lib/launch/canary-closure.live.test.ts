import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SPRINT PHASE 1 — REAL CANARY CLOSURE.
 *
 * Two blocks:
 *  • LIVE (runIf CANARY_CLOSURE) — the corrected fixture through the closest real entrypoint (runInspectionJob →
 *    inspectAndPlan → runMissionBrain → grounded shadow) with ONLY the grounded architect + V3 critic paid
 *    (google/gemini-3.1-flash-lite-preview). Ledger cap 2. This was RUN once; it blocked at the canonical gate
 *    on the fixture corpus (recorded in the amendment) — founderCanaryReady was NOT set. Not re-run (2-call cap).
 *  • DETERMINISTIC (runIf CANARY_CLOSURE_DET) — 0 paid calls: fake grounded providers return a gate-PASSING
 *    draft, proving the genuinely-new machinery end-to-end: job → grounded plan SELECTED → revision persisted
 *    (generated_grounded_v2, grounded provenance) → REAL approval service recomputes hashes+budget → stale
 *    revision rejected → approveRevision → an unapproved plan cannot be considered approved. Temp DB via
 *    SAGE_DB_PATH; runs only under its npm script, never in `npm run test`.
 */

const PAID = process.env.CANARY_CLOSURE === "1";
const DET = process.env.CANARY_CLOSURE_DET === "1";
const CANARY_MODEL = "google/gemini-3.1-flash-lite-preview";
const WALLET = "0x00000000000000000000000000000000000000c1";
const LEDGER = path.resolve("promotion-evidence/canary-closure.ledger.json");
const EVIDENCE = path.resolve("promotion-evidence/canary-closure.json");
const CAP = 2;

vi.mock("./inspect", async (orig) => ({ ...(await orig<typeof import("./inspect")>()), inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("./field-test", async (orig) => ({ ...(await orig<typeof import("./field-test")>()), fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("./github", async (orig) => ({ ...(await orig<typeof import("./github")>()), inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("./inspection-replay", async (orig) => ({ ...(await orig<typeof import("./inspection-replay")>()), runReplayShadow: vi.fn() }));
vi.mock("@/lib/llm/complete", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/complete")>();
  return { ...real, llmConfigured: () => true, llmCompleteJson: vi.fn() };
});

import { inspectProduct } from "./inspect";
import { runFieldTest } from "./field-test";
import { runReplayShadow } from "./inspection-replay";
import { llmCompleteJson } from "@/lib/llm/complete";
import { deriveObservations, decisiveFacts } from "./observed-facts";
import { deserializePlan } from "./serde";
import { verifyPlanForApproval } from "./approve";
import { MISSION_PROMPT_VERSION } from "./mission-prompt";
import type { FieldTestState, FieldTestSummary, ProductObservation } from "./schemas";

// A fixture PROVEN to pass the canonical gate (the entrypoint-test scenario): welcome→garden world.
const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://yara.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = {
  ran: true, startUrl: "https://yara.test/", mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10,
  states: [
    stt({ trigger: "initial load", visibleTextExcerpt: "Welcome. Press start.", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
    stt({ trigger: "clicked 'Start'", url: "https://yara.test/play", visibleTextExcerpt: "You reach the garden world.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
  ],
};
const obs = (url: string): ProductObservation => ({ url, status: 200, title: "Yara", headings: ["Welcome"], claims: [], ctas: ["Start"], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Welcome. Press start."], inspectedAt: 1, contentSha256: "a".repeat(64) });
const SET = deriveObservations(FT);
const startFact = decisiveFacts(SET).find((f) => f.elementName === "Start")!;
const transId = SET.transitions[0].id;

// grounded architect draft (semantic-draft) proven to compile + ground + pass the gate; V3 critic supports.
const groundedDraft = { missions: [{ missionKey: "reach-start", title: "Check the Start label", objective: "Verify the homepage's primary call-to-action label", instructions: "1. Open the homepage. 2. Report the exact label of the primary call-to-action.", whyItMatters: "core onboarding", priority: "high", riskCategory: "critical_journey", effortMinutes: 3, rewardWeight: 5, maxCompletions: 3, confidence: 0.8, conditions: [], assumptions: [], disallowed: [], criteria: [{ text: "The homepage's primary call-to-action is labeled 'Start'", evidenceRequirement: "Quote the exact label of the primary call-to-action", criterionKind: "content_claim", factRefs: [startFact.id], transitionRef: null, evidenceMode: "observation", supportRationale: "the Start label was observed" }] }] };
const reply = (json: unknown, model: string, provider: string) => ({ json, model, provider, latencyMs: 1, promptTokens: 0, completionTokens: 0 });

function appendLedger(entry: Record<string, unknown>) {
  const prior: { calls: unknown[] } = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { evaluationId: "canary-closure", cap: CAP, calls: [] };
  prior.calls.push(entry);
  fs.writeFileSync(LEDGER, JSON.stringify(prior, null, 2));
  if (prior.calls.length > CAP) throw new Error(`ledger cap exceeded: ${prior.calls.length}/${CAP}`);
}

async function runClosure(opts: { live: boolean }) {
  process.env.MISSION_GROUNDING_MODE = "canary";
  process.env.MISSION_CANARY_ALLOWLIST = WALLET;
  process.env.MISSION_MODEL = CANARY_MODEL;
  process.env.MISSION_GROUNDING_CRITIC_MODEL = CANARY_MODEL;
  process.env.INSPECTION_REPLAY_MODE = "shadow";

  vi.mocked(inspectProduct).mockResolvedValue({ startUrl: "https://yara.test/", host: "yara.test", observations: [obs("https://yara.test/"), obs("https://yara.test/play")], limitations: [], blocked: [] });
  vi.mocked(runFieldTest).mockResolvedValue(FT);
  vi.mocked(runReplayShadow).mockResolvedValue({ ran: true, probes: 1, byClassification: { reproduced: 1 }, records: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] } as never);

  const real = opts.live ? (await vi.importActual<typeof import("@/lib/llm/complete")>("@/lib/llm/complete")).llmCompleteJson : null;
  vi.mocked(llmCompleteJson).mockImplementation(async (o) => {
    const system = o.system ?? "";
    if (system.includes("GROUNDED mission architect")) { if (opts.live && real) { appendLedger({ role: "architect", model: CANARY_MODEL }); return real(o); } return reply(groundedDraft, CANARY_MODEL, "commonstack") as never; }
    if (system.includes("grounding CRITIC")) { if (opts.live && real) { appendLedger({ role: "critic", model: CANARY_MODEL }); return real(o); } return reply({ verdicts: [{ decisionId: "d0", verdict: "supported" }] }, CANARY_MODEL, "commonstack") as never; }
    return reply({ missions: [{ missionKey: "legacy-x", title: "L", objective: "o", instructions: "1. s", targetSurface: "https://yara.test/" }] }, "legacy-model", "legacy-prov") as never;
  });

  const { createInspectionJob, getInspectionJob } = await import("@/lib/db/inspection");
  const { getCurrentRevision, getApprovedRevision, approveRevision } = await import("@/lib/db/plan-revisions");
  const { runInspectionJob } = await import("./job");

  const publicCampaignId = (opts.live ? "cc-live-" : "cc-det-") + transId.slice(0, 8);
  const { job } = createInspectionJob({ founderWallet: WALLET, publicCampaignId, productUrl: "https://yara.test/", repoUrl: null, goal: "Verify the homepage's primary call-to-action label.", targetUsers: "players", totalBudgetBase: BigInt(3_000_000), tokenDecimals: 6, planningRequestId: `prid:test:cc-${publicCampaignId}`, surface: "test" });
  await runInspectionJob(job.id);

  const after = getInspectionJob(job.id)!;
  const rev = getCurrentRevision(job.id);
  const result = after.result as { stage?: string; reason?: string; canary?: { status?: string; planSource?: string; reason?: string | null; provenance?: Record<string, unknown> }; brain?: { ok?: boolean; reason?: string } } | null;
  const out: Record<string, unknown> = { jobStatus: after.status, canaryStatus: result?.canary?.status ?? null, canaryReason: result?.canary?.reason ?? null, planSource: result?.canary?.planSource ?? null, brainReason: result?.brain?.reason ?? null, revisionReason: rev?.reason ?? null, revisionModel: rev?.model ?? null, provenance: result?.canary?.provenance ?? null, approvedBeforeApproval: !!getApprovedRevision(job.id) };
  if (rev) {
    const verified = verifyPlanForApproval(deserializePlan(rev.planJson), { approver: WALLET, model: rev.model, provider: rev.provider, promptVersion: MISSION_PROMPT_VERSION });
    out.approvalRecompute = verified.ok ? "ok" : `mismatch:${(verified as { error: string }).error}`;
    if (verified.ok) {
      out.staleRejected = !approveRevision(job.id, rev.revisionNumber + 5, WALLET, verified.approvalRecord).ok;
      out.approved = approveRevision(job.id, rev.revisionNumber, WALLET, verified.approvalRecord).ok;
      out.approvedAfter = !!getApprovedRevision(job.id);
    }
  }
  return out;
}

describe.runIf(PAID)("Phase 1 — REAL CANARY CLOSURE (LIVE, ≤2 paid calls)", () => {
  beforeAll(() => { try { process.loadEnvFile(path.resolve(".env")); } catch { /* key may already be present */ } });
  it("records the live grounded architect + V3 critic closure attempt (exact stage)", async () => {
    expect(process.env.CANARY_CLOSURE_CONFIRM).toBe("CALL_CAP_2");
    const r = await runClosure({ live: true });
    const canaryReady = r.jobStatus === "ready" && r.canaryStatus === "selected" && r.planSource === "grounded_v2" && r.revisionReason === "generated_grounded_v2" && r.approved === true;
    fs.writeFileSync(EVIDENCE, JSON.stringify({ artifact: "canary-closure", mode: "live", founderCanaryReady: canaryReady, ...r }, null, 2));
    console.log("[canary-closure LIVE] founderCanaryReady=" + canaryReady + " status=" + r.canaryStatus + " reason=" + r.canaryReason);
    const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { calls: [] };
    expect(ledger.calls.length).toBeLessThanOrEqual(CAP);
  }, 120_000);
});

describe.runIf(DET)("Phase 1 — CANARY CLOSURE MACHINERY (deterministic, 0 paid)", () => {
  it("selects the grounded plan → persists a generated_grounded_v2 revision → real approval service approves", async () => {
    const r = await runClosure({ live: false });
    expect(r.jobStatus).toBe("ready");
    expect(r.canaryStatus).toBe("selected");
    expect(r.planSource).toBe("grounded_v2");
    expect(r.revisionReason).toBe("generated_grounded_v2");
    expect(r.revisionModel).toBe(CANARY_MODEL); // grounded model, NOT the legacy model
    expect((r.provenance as { planSource?: string })?.planSource).toBe("grounded_v2");
    expect(r.approvedBeforeApproval).toBe(false); // unapproved before the founder acts
    expect(r.approvalRecompute).toBe("ok");        // server recomputes hashes + exact budget
    expect(r.staleRejected).toBe(true);            // a stale revision number is rejected
    expect(r.approved).toBe(true);                 // exact current revision approved
    expect(r.approvedAfter).toBe(true);
    fs.writeFileSync(EVIDENCE.replace(".json", "-deterministic.json"), JSON.stringify({ artifact: "canary-closure", mode: "deterministic", machineryProven: true, ...r }, null, 2));
    console.log("[canary-closure DET] machinery proven — selected→revision→approval");
  }, 60_000);
});
