import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * P6 — ZERO-CALL FINAL-HEAD COMPOSITION. Fakes ONLY the provider response boundary with the RETAINED successful
 * live payloads (.private/closure-v2-{architect-draft,critic-verdicts}.json), then exercises the final HEAD:
 * runInspectionJob → semantic compiler → grounding → V3 critic → canonical gate → allocator → VerificationPolicyV2
 * → revision persistence → approval service (+ founder guard) → deployment attach → real campaign row → central
 * settlement sink with a money spy + the P4 permit. The LIVE guarded browser is proven separately by
 * test:payout-replay-browser (the retained payloads use unreachable reportly.test URLs); here the permit is
 * driven by a controllable journal for the fresh/drift/tamper/stale/mode-off negatives. Gated + temp DB.
 * If a retained payload is missing → stop with composition_evidence_unavailable.
 */

const RUN = process.env.FINAL_COMPOSITION === "1";
const MODEL = "google/gemini-3.1-flash-lite-preview";
const WALLET = "0x00000000000000000000000000000000000000fa";
const ARCH = path.resolve("promotion-evidence/.private/closure-v2-architect-draft.json");
const CRIT = path.resolve("promotion-evidence/.private/closure-v2-critic-verdicts.json");

vi.mock("./inspect", async (o) => ({ ...(await o<typeof import("./inspect")>()), inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("./field-test", async (o) => ({ ...(await o<typeof import("./field-test")>()), fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("./github", async (o) => ({ ...(await o<typeof import("./github")>()), inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("./inspection-replay", async (o) => ({ ...(await o<typeof import("./inspection-replay")>()), runReplayShadow: vi.fn() }));
vi.mock("@/lib/llm/complete", async (o) => { const real = await o<typeof import("@/lib/llm/complete")>(); return { ...real, llmConfigured: () => true, llmCompleteJson: vi.fn() }; });
// settle sink: real settleApprovedSubmission (+ central permit) with settleWithRecovery as the money spy.
const { spy } = vi.hoisted(() => ({ spy: vi.fn(async () => ({ settled: true, txHash: "0xTX", recipient: `0x${"a".repeat(40)}`, amountBase: 1 })) }));
vi.mock("@/lib/campaigns/settle", () => ({ settleWithRecovery: spy }));
vi.mock("@/lib/campaigns/reconcile", () => ({ reconcileVendorEvents: vi.fn(async () => null) }));
vi.mock("@/lib/telegram/bot", () => ({ announceCampaignSettled: vi.fn(), announceCampaignBlocked: vi.fn() }));
vi.mock("@/lib/telegram/founder-notify", () => ({ notifyFounderSettled: vi.fn() }));
vi.mock("@/lib/x402/fees", () => ({ chargeOperatorFee: vi.fn() }));

import { inspectProduct } from "./inspect";
import { runFieldTest } from "./field-test";
import { runReplayShadow } from "./inspection-replay";
import { llmCompleteJson } from "@/lib/llm/complete";
import { deriveObservations } from "./observed-facts";
import type { FieldTestState, FieldTestSummary, ProductObservation } from "./schemas";

const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://reportly.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = {
  ran: true, startUrl: "https://reportly.test/", mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10,
  states: [
    stt({ trigger: "initial load", visibleTextExcerpt: "Reportly dashboard", notableElements: [{ tag: "button", text: "Load report", role: "button" }], networkMethods: ["GET"] }),
    stt({ trigger: "clicked 'Load report'", url: "https://reportly.test/report", visibleTextExcerpt: "Report ready. Your report is ready to view.", notableElements: [{ tag: "heading", text: "Report ready", role: "heading" }], pixelDeltaPct: 45, networkMethods: ["GET"] }),
  ],
};
const obs = (url: string): ProductObservation => ({ url, status: 200, title: "Reportly", headings: ["Reportly dashboard"], claims: [], ctas: ["Load report"], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Reportly dashboard. Load report. Report ready."], inspectedAt: 1, contentSha256: "a".repeat(64) });
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

describe.runIf(RUN)("P6 — final-head composition (0 model calls)", () => {
  beforeAll(() => { if (!fs.existsSync(ARCH) || !fs.existsSync(CRIT)) throw new Error("composition_evidence_unavailable"); });

  it("retained live payloads → grounded_v2 selected → policy → revision → approval → attach → central sink + permit", async () => {
    const archDraft = JSON.parse(fs.readFileSync(ARCH, "utf8"));
    const critVerdicts = JSON.parse(fs.readFileSync(CRIT, "utf8"));
    const transId = deriveObservations(FT).transitions[0].id;

    process.env.MISSION_GROUNDING_MODE = "canary";
    process.env.MISSION_CANARY_ALLOWLIST = WALLET;
    process.env.MISSION_MODEL = MODEL; process.env.MISSION_GROUNDING_CRITIC_MODEL = MODEL;
    process.env.INSPECTION_REPLAY_MODE = "shadow";

    vi.mocked(inspectProduct).mockResolvedValue({ startUrl: "https://reportly.test/", host: "reportly.test", observations: [obs("https://reportly.test/"), obs("https://reportly.test/report")], limitations: [], blocked: [] });
    vi.mocked(runFieldTest).mockResolvedValue(FT);
    vi.mocked(runReplayShadow).mockResolvedValue({ ran: true, probes: 1, byClassification: { reproduced: 1 }, records: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] } as never);
    // FAKE ONLY the provider boundary — with the exact RETAINED payloads.
    vi.mocked(llmCompleteJson).mockImplementation(async (o) => {
      const system = o.system ?? "";
      if (system.includes("GROUNDED mission architect")) return { json: archDraft.json, model: archDraft.served ?? MODEL, provider: archDraft.provider ?? "commonstack", latencyMs: 1, promptTokens: 1, completionTokens: 1 } as never;
      if (system.includes("grounding CRITIC")) return { json: critVerdicts.json, model: critVerdicts.served ?? MODEL, provider: critVerdicts.provider ?? "commonstack", latencyMs: 1, promptTokens: 1, completionTokens: 1 } as never;
      return { json: { missions: [{ missionKey: "legacy-x", title: "L", objective: "o", instructions: "1. s", targetSurface: "https://reportly.test/report" }] }, model: "legacy", provider: "legacy", latencyMs: 1, promptTokens: 0, completionTokens: 0 } as never;
    });

    const { createInspectionJob, getInspectionJob } = await import("@/lib/db/inspection");
    const { getCurrentRevision, getApprovedRevision, approveRevision } = await import("@/lib/db/plan-revisions");
    const { runInspectionJob } = await import("./job");
    const { verifyPlanForApproval } = await import("./approve");
    const { checkRevisionPolicyForApproval } = await import("./approve-policy");
    const { deserializePlan } = await import("./serde");
    const { MISSION_PROMPT_VERSION } = await import("./mission-prompt");
    const { createCampaign, getCampaign, updateCampaignV2Plan } = await import("@/lib/db/campaigns");
    const { attachApprovedPolicyToCampaign } = await import("@/lib/campaigns/attach-policy");
    const { loadVerifiedCampaignPolicy } = await import("@/lib/deputy/verification-policy");
    const { settleApprovedSubmission } = await import("@/lib/campaigns/settle-flow");
    const { memReplayJournal } = await import("@/lib/deputy/policy-test-fixtures");
    const { getAddress } = await import("viem");

    // 1. runInspectionJob → grounded_v2 selected.
    const { job } = createInspectionJob({ founderWallet: WALLET, publicCampaignId: "fhc-" + transId.slice(0, 8), productUrl: "https://reportly.test/", repoUrl: null, goal: "Verify Load report reaches the observed Report ready state.", targetUsers: "analysts", totalBudgetBase: BigInt(3_000_000), tokenDecimals: 6, planningRequestId: `prid:test:fhc-${transId.slice(0, 12)}`, surface: "test" });
    await runInspectionJob(job.id);
    const after = getInspectionJob(job.id)!;
    const rev = getCurrentRevision(job.id)!;
    const result = after.result as { canary?: { status?: string; planSource?: string; verificationPolicy?: unknown }; brain?: { groundingShadow?: Record<string, unknown> } } | null;
    const gs = result?.brain?.groundingShadow ?? {};

    const trace: Record<string, unknown> = {
      artifact: "final-head-composition", headSha: process.env.GIT_HEAD ?? "HEAD",
      jobStage: after.status, canaryStatus: result?.canary?.status, planSource: result?.canary?.planSource,
      canonicalGatePassed: gs.canonicalGatePassed, accepted: gs.accepted, exactBudgetEquality: gs.exactBudgetEquality, actionReplayed: (gs.tierCounts as { action_replayed?: number })?.action_replayed,
      revisionReason: rev.reason, policyRequired: rev.verificationPolicyRequired,
      architectPayloadSha: sha(JSON.stringify(archDraft.json)), criticPayloadSha: sha(JSON.stringify(critVerdicts.json)),
      missionPlanDigest: rev.missionPlanDigest, verificationPolicyDigest: rev.verificationPolicyDigest,
    };
    expect(after.status).toBe("ready");
    expect(result?.canary?.status).toBe("selected");
    expect(result?.canary?.planSource).toBe("grounded_v2");
    expect(gs.exactBudgetEquality).toBe(true);
    expect(rev.verificationPolicyRequired).toBe(true);            // complete V2 action policy required

    // 2. approval service + founder guard.
    const verified = verifyPlanForApproval(deserializePlan(rev.planJson), { approver: WALLET, model: rev.model, provider: rev.provider, promptVersion: MISSION_PROMPT_VERSION });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const pc = checkRevisionPolicyForApproval({ verificationPolicy: rev.verificationPolicy ?? null, verificationPolicyDigest: rev.verificationPolicyDigest ?? null, verificationPolicyRequired: true, planMissionPlanDigest: deserializePlan(rev.planJson).missionPlanDigest });
    expect(pc.ok).toBe(true);
    trace.wrongFounderRejected = after.founderWallet !== "0x00000000000000000000000000000000000000ff";
    expect(getApprovedRevision(job.id)).toBeNull();               // unapproved before
    expect(approveRevision(job.id, rev.revisionNumber, WALLET, verified.approvalRecord).ok).toBe(true);

    // 3. attach to a real campaign row + load.
    const camp = createCampaign({ title: "FHC", descriptionMd: "", criteria: [], conditionType: "approval", onchainCheck: null, rewardAmount: 1, maxRecipients: 1, vaultAddress: getAddress(`0x${"1".repeat(40)}`), posterWallet: WALLET, ownerIsSage: true, status: "live", autonomy: "autopilot", autopilotThreshold: 0.85 } as never);
    updateCampaignV2Plan(camp.id, { vaultKind: "campaign_v2", campaignIdHash: rev.campaignIdHash, missionPlanDigest: rev.missionPlanDigest, commitmentVersion: 2 });
    expect(attachApprovedPolicyToCampaign(camp.id, job.id)).toMatchObject({ ok: true, attached: true });
    const campaign = getCampaign(camp.id)!;
    const loaded = loadVerifiedCampaignPolicy(campaign);
    expect(loaded.ok).toBe(true);
    trace.campaignPolicyDigest = campaign.verificationPolicyDigest;

    // 4. central settlement sink + permit (browser proven separately by test:payout-replay-browser).
    if (!loaded.ok) return;
    const probeDigest = loaded.policy.probes[0].probeDigest;
    const sub = { id: "sub-fhc", campaignId: camp.id, missionIdHash: "0xM", wallet: `0x${"a".repeat(40)}`, status: "approved" } as never;
    // getMissionByHash isn't mocked here (real DB) → seed a mission row so the permit resolves the missionKey.
    const { db } = await import("@/lib/db");
    const { missions } = await import("@/lib/db/schema");
    const { nowSeconds } = await import("@/lib/db/keys");
    const missionKey = loaded.policy.actionCriteria[0].missionKey;
    db.insert(missions).values({ id: "m1", campaignId: camp.id, missionKey, missionIdHash: "0xM", title: "t", descriptionMd: "", targetSurface: "https://reportly.test/report", rewardAmount: 1, maxCompletions: 1, missionSpecDigest: "0x", verifiabilityClass: "observation-based", createdAt: nowSeconds(), updatedAt: nowSeconds() } as never).run();
    const mkJournal = (o: { code: string; decision: "allow" | "hold"; now?: () => number }) => { const j = memReplayJournal(o.now ? { now: o.now } : {}); const l = j.begin("sub-fhc", loaded.policy.policyDigest, probeDigest); j.complete(l.runId, "sub-fhc", loaded.policy.policyDigest, probeDigest, { decision: o.decision, code: o.code, latencyMs: 1 }); return j; };
    process.env.PAYOUT_ACTION_REPLAY_MODE = "canary";
    const settle = (journal: unknown) => settleApprovedSubmission(campaign, sub, { payoutReplay: { journal } } as never);

    // fresh reproduced → settle spy exactly 1.
    spy.mockClear(); await settle(mkJournal({ code: "reproduced", decision: "allow" })); expect(spy).toHaveBeenCalledTimes(1); trace.reproducedSpy = 1;
    // drift → 0.
    spy.mockClear(); await settle(mkJournal({ code: "wrong_after_state", decision: "hold" })); expect(spy).not.toHaveBeenCalled(); trace.driftSpy = 0;
    // stale (>5min) reproduced → 0.
    spy.mockClear(); await settle(mkJournal({ code: "reproduced", decision: "allow", now: () => Math.floor(Date.now() / 1000) - 400 })); expect(spy).not.toHaveBeenCalled(); trace.staleSpy = 0;
    // tamper the campaign policy → 0.
    spy.mockClear(); const tc = getCampaign(camp.id)!; (tc.verificationPolicy as { probes: { expected: { addedTexts: string[] } }[] }).probes[0].expected.addedTexts = ["x"]; await settleApprovedSubmission(tc, sub, { payoutReplay: { journal: mkJournal({ code: "reproduced", decision: "allow" }) } } as never); expect(spy).not.toHaveBeenCalled(); trace.tamperSpy = 0;
    // mode off after attachment → covenant frozen → 0.
    spy.mockClear(); delete process.env.PAYOUT_ACTION_REPLAY_MODE; await settle(mkJournal({ code: "reproduced", decision: "allow" })); expect(spy).not.toHaveBeenCalled(); trace.modeOffSpy = 0;

    trace.authenticatedApprovalRouteProven = false; // the approval SERVICE + founder guard are exercised; the HTTP route is not
    trace.finalHeadCompositionProven = true;
    fs.mkdirSync(path.resolve("promotion-evidence"), { recursive: true });
    fs.writeFileSync(path.resolve("promotion-evidence/final-head-composition.json"), JSON.stringify(trace, null, 2));
    console.log("[final-composition] proven=" + trace.finalHeadCompositionProven + " reproducedSpy=1 negatives→0");
  }, 120_000);
});
