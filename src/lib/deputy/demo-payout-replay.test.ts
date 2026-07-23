import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * PHASE 7 — VERTICAL DEMO: "Sage performs the mission itself before it pays."
 *
 * Enters through the REAL settlement path (runDeputyOnSubmission → the real pre-broadcast gate) with a REAL
 * guarded browser (real runInspectionProbe against a controlled product). ONLY the external edges are faked:
 * money (settleApprovedSubmission = a "would settle" spy — no tx broadcast) and the model/DB reads. No real
 * funding, no chain write, no payout. Run: `npm run demo:payout-replay` (needs chromium).
 */

const RUN = process.env.DEMO_PAYOUT_REPLAY === "1";
const log = (s: string) => console.log(s);

vi.mock("@/lib/db/campaigns", () => ({
  getSubmission: vi.fn(), getCampaign: vi.fn(), getDecisionBySubmission: vi.fn(), casSubmissionStatus: vi.fn(() => true),
  recordEvent: vi.fn(), recordEventOnce: vi.fn(() => ({ inserted: true })), updateSubmission: vi.fn(),
  listPaidSubmissionsForDedup: vi.fn(() => []), listSubmissionsForDedup: vi.fn(() => []), listEarlierSubmissionsForDedup: vi.fn(() => []),
  countPaidByWalletInCampaign: vi.fn(() => 0), setObservationShadow: vi.fn(), getMissionByHash: vi.fn(), listMissions: vi.fn(() => []),
}));
vi.mock("./observation-judge", () => ({ runObservationDecision: vi.fn(), observationAutopayEnabled: vi.fn(() => false), toObservationShadow: vi.fn(() => ({})) }));
vi.mock("@/lib/deputy/chain", () => ({ getVaultState: vi.fn(), isVendorApproved: vi.fn() }));
vi.mock("@/lib/campaigns/settle-flow", () => ({ settleApprovedSubmission: vi.fn() }));
vi.mock("./decisions", () => ({ ensureDecision: vi.fn() }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn() }));
vi.mock("@/lib/telegram/founder-notify", () => ({ notifyFounderHeld: vi.fn() }));
vi.mock("./agent-log", () => ({ newCorrelationId: () => "demo_cid", agentLog: vi.fn() }));
vi.mock("./entailment", () => ({ entailmentMode: vi.fn(() => "off"), entailmentInputFromBrief: vi.fn(() => ({ criteria: [], note: null })), runEntailmentVeto: vi.fn(async () => ({ ran: false, vetoed: false, verdicts: [] })) }));

import { runDeputyOnSubmission } from "./pipeline";
import { getSubmission, getCampaign, getDecisionBySubmission, getMissionByHash } from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { ensureDecision } from "./decisions";
import { __approveForTest, __clearTestApprovals } from "./model-policy";
import { compileVerificationPolicyV2 } from "@/lib/launch/mission-probe-v2";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { ReplayJournalHandle } from "@/lib/db/payout-replay-journal";

const noopJournal: ReplayJournalHandle = { lookup: () => null, begin: () => ({ runId: "r", attempt: 1 }), complete: () => true };
let fx: { port: number; close: () => Promise<void> };
const PAGE = (drift: boolean) => `<!doctype html><title>Reportly</title><main><button id="b">Load report</button><div id="o"></div></main><script>document.getElementById('b').addEventListener('click',function(){document.getElementById('o').textContent=${drift ? "'Loading failed'" : "'Report ready'"};});</script>`;
beforeAll(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE(/drift/.test(req.url ?? ""))); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  fx = { port: (server.address() as AddressInfo).port, close: () => new Promise((r) => server.close(() => r())) };
});
afterAll(async () => { await fx?.close(); });

function bound(path: string): Campaign {
  const url = `http://127.0.0.1:${fx.port}${path}`;
  const scope: ValidationScope = { hosts: new Set([`127.0.0.1:${fx.port}`]) } as ValidationScope;
  const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true, pageUrl: url, stateId: "s-after", visibleTexts: ["Report ready"], provenanceDigest: "pd" };
  const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t-load", startUrl: url, beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Load report" }, afterUrl: url, afterStateDigest: "s-after", addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
  const set: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
  const mission: CandidateMission = { missionKey: "m-load", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation" }] } } as unknown as CandidateMission;
  const policy = compileVerificationPolicyV2({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set, missions: [mission], replayReproduced: new Set(["t-load"]), scope }).policy;
  return { id: "c1", title: "Load-report campaign", rewardAmount: 400_000, vaultAddress: `0x${"1".repeat(40)}`, ownerIsSage: true, autonomy: "autopilot", autopilotThreshold: 0.85, perWalletPayoutCap: 1, missionPlanDigest: "0xplan", verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest, verificationPolicyRequired: true } as unknown as Campaign;
}
const submission = { id: "s1", campaignId: "c1", wallet: `0x${"a".repeat(40)}`, status: "pending", missionIdHash: "0xMISSION", note: "I clicked Load report and the report appeared." } as unknown as Submission;
const payBrief: DecisionBrief = { engine: "llm", model: "google/gemini-3.1-flash-lite-preview", provider: "api.commonstack.ai", promptVersion: "payout-v1", parserVersion: "payout-parse-v3", criteria: [], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.95, summary: "", evidenceOk: true, contentSha256: null, latencyMs: 5, costUsd: 0.0003, x402PaymentTx: null };
const hooks = () => ({ payoutReplay: { allowLoopback: new Set([`127.0.0.1:${fx.port}`]), egressAllowedPorts: new Set([80, 443, fx.port]), journal: noopJournal } });

beforeEach(() => {
  vi.clearAllMocks();
  __clearTestApprovals();
  __approveForTest({ provider: "api.commonstack.ai", model: "google/gemini-3.1-flash-lite-preview", promptVersion: "payout-v1", parserVersion: "payout-parse-v3" });
  vi.mocked(getSubmission).mockReturnValue(submission);
  vi.mocked(getDecisionBySubmission).mockReturnValue({ id: "dec1" } as never);
  vi.mocked(ensureDecision).mockResolvedValue(payBrief);
  vi.mocked(getMissionByHash).mockReturnValue({ missionKey: "m-load", verifiabilityClass: "url-verifiable" } as never);
  vi.mocked(getVaultState).mockResolvedValue({ status: "active", remaining: 100, perTxCap: 100, velocityCap: 100 } as never);
  vi.mocked(settleApprovedSubmission).mockResolvedValue({ outcome: { settled: true, txHash: "0xWOULD_SETTLE", recipient: submission.wallet, amountBase: 400_000 } } as never);
  process.env.PAYOUT_ACTION_REPLAY_MODE = "canary";
});

describe.runIf(RUN)("DEMO — Sage performs the mission before it pays", () => {
  it("qualified + Sage reproduces the action → the payout may continue (would-settle; no tx broadcast)", async () => {
    vi.mocked(getCampaign).mockReturnValue(bound("/"));
    log("\n╭─ DEMO: payout action replay ──────────────────────────────");
    log("│ 1. Tester claims: “I clicked Load report and the report appeared.”  (evidence judge: PAY @ 95%)");
    log("│ 2. Sage opens a FRESH guarded browser and performs 'Load report' itself…");
    const r = await runDeputyOnSubmission("s1", hooks());
    log(`│ 3. Sage observed the exact expected state → replay: reproduced`);
    log(`│ 4. Only NOW may the already-qualified payout continue → action=${r.action} (would-settle: ${vi.mocked(settleApprovedSubmission).mock.calls.length === 1 ? "yes" : "no"}, tx=SPY, no broadcast)`);
    expect(r.action).toBe("settled");
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
  });

  it("qualified + the product DRIFTED (Sage could not reproduce it) → HOLD, settlement spy stays ZERO", async () => {
    vi.mocked(getCampaign).mockReturnValue(bound("/?drift=1"));
    log("│ ── drift variant ─────────────────────────────────────────");
    log("│ 1. Same tester claim + PAY judge. 2. Sage performs 'Load report' itself…");
    const r = await runDeputyOnSubmission("s1", hooks());
    log(`│ 3. Sage observed a DIFFERENT state → replay VETO`);
    log(`│ 4. Sage HOLDS: ${r.reason}  (settlement spy calls: ${vi.mocked(settleApprovedSubmission).mock.calls.length})`);
    log("╰───────────────────────────────────────────────────────────");
    log("\nThesis: tester claimed the action → Sage independently performed it → Sage observed the outcome →");
    log("only then could the already-qualified payout continue. A claim Sage cannot reproduce is never paid.\n");
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/^action_replay_veto:/);
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
  });
});
