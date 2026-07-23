import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * PHASE 4 — SELF-CANARY STAGING DEMO ("Sage performs the mission before it pays"). Runs the money-critical path
 * through the REAL deputy settlement gate + a REAL guarded browser; only money/model/DB edges are faked
 * (settleApprovedSubmission = a would-settle spy — no tx broadcast). The founder→approval→policy-attach
 * front-half is proven LIVE end-to-end by Phase 3 (canary-runtime-closure-v2: real approval + policy persisted);
 * this demo exercises the staging deputy behaviour: one qualified reproduce + three negative variants.
 * Run: npm run demo:self-canary (needs chromium). No paid model calls; no funding/deploy/settlement.
 */

const RUN = process.env.DEMO_SELF_CANARY === "1";
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
vi.mock("./canary-preflight", () => ({ payoutReplaySchemaReady: vi.fn(() => ({ ok: true, missing: [] })) }));

import { runDeputyOnSubmission } from "./pipeline";
import { getSubmission, getCampaign, getDecisionBySubmission, getMissionByHash } from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { ensureDecision } from "./decisions";
import { __approveForTest, __clearTestApprovals } from "./model-policy";
import { compileVerificationPolicyV2 } from "@/lib/launch/mission-probe-v2";
import { verificationPolicyV2Digest } from "@/lib/launch/mission-probe-v2";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { ReplayJournalHandle } from "@/lib/db/payout-replay-journal";

const noopJournal: ReplayJournalHandle = { lookup: () => null, begin: () => {}, complete: () => {} };
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
  return { id: "c1", title: "Load-report staging campaign", rewardAmount: 500_000, vaultAddress: `0x${"1".repeat(40)}`, ownerIsSage: true, autonomy: "autopilot", autopilotThreshold: 0.85, perWalletPayoutCap: 1, missionPlanDigest: "0xplan", verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest, verificationPolicyRequired: true } as unknown as Campaign;
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
  vi.mocked(settleApprovedSubmission).mockResolvedValue({ outcome: { settled: true, txHash: "0xWOULD_SETTLE", recipient: submission.wallet, amountBase: 500_000 } } as never);
  process.env.PAYOUT_ACTION_REPLAY_MODE = "canary";
});
const spy = () => vi.mocked(settleApprovedSubmission).mock.calls.length;

describe.runIf(RUN)("DEMO — self-canary staging", () => {
  it("front-half (proven live in Phase 3): the policy digest recomputes over the attached campaign policy", () => {
    const c = bound("/");
    expect(verificationPolicyV2Digest(c.verificationPolicy as Parameters<typeof verificationPolicyV2Digest>[0])).toBe(c.verificationPolicyDigest);
    log("\n╭─ DEMO: self-canary staging ───────────────────────────────");
    log("│ Front-half (LIVE in Phase 3): allowlisted founder owns the inspection → grounded V2 plan is the");
    log("│   current revision → founder approves via the real approval service → policy attaches to the campaign.");
    log("│   (Here: the attached policy digest recomputes = bound + immutable.)");
  });
  it("1) qualified tester + Sage reproduces the action → would-settle (spy 1, no broadcast)", async () => {
    vi.mocked(getCampaign).mockReturnValue(bound("/"));
    const r = await runDeputyOnSubmission("s1", hooks());
    log(`│ 1. qualified evidence + Sage reproduced 'Load report' → ${r.action} (would-settle: ${spy() === 1 ? "yes" : "no"}, tx=SPY)`);
    expect(r.action).toBe("settled"); expect(spy()).toBe(1);
  });
  it("A) product drift → HOLD wrong_after_state, spy 0", async () => {
    vi.mocked(getCampaign).mockReturnValue(bound("/?drift=1"));
    const r = await runDeputyOnSubmission("s1", hooks());
    log(`│ A. product drift → ${r.reason} (spy ${spy()})`);
    expect(r.action).toBe("held"); expect(r.reason).toBe("action_replay_veto:wrong_after_state"); expect(spy()).toBe(0);
  });
  it("B) policy tampering → HOLD policy_digest_mismatch, spy 0 (browser need not run)", async () => {
    const c = bound("/"); (c.verificationPolicy as { probes: { expected: { addedTexts: string[] } }[] }).probes[0].expected.addedTexts = ["anything"];
    vi.mocked(getCampaign).mockReturnValue(c);
    const r = await runDeputyOnSubmission("s1", hooks());
    log(`│ B. policy tampering → ${r.reason} (spy ${spy()})`);
    expect(r.action).toBe("held"); expect(r.reason).toBe("action_replay_veto:policy_digest_mismatch"); expect(spy()).toBe(0);
  });
  it("C) browser reproduces but the evidence judge does NOT qualify → remains HELD, spy 0", async () => {
    vi.mocked(getCampaign).mockReturnValue(bound("/"));
    vi.mocked(ensureDecision).mockResolvedValue({ ...payBrief, recommendation: "hold", reasonCode: "no_evidence", confidence: 0.2, evidenceOk: false });
    const r = await runDeputyOnSubmission("s1", hooks());
    log(`│ C. Sage reproduces the action, but the tester's own evidence fails the judge → ${r.action} (spy ${spy()})`);
    log("╰───────────────────────────────────────────────────────────");
    log("\nThesis: tester evidence supports THAT tester's submission; Sage's replay corroborates the product action");
    log("currently works. Neither alone manufactures payment — both must hold before money can move.\n");
    expect(r.action).toBe("held"); expect(spy()).toBe(0);
  });
});
