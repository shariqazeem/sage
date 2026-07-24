import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * AUTHENTICATED APPROVAL ROUTE — genuine SIWE. A real ephemeral wallet signs the exact SIWE message; the REAL
 * nonce → verifyMessage → HMAC session → getSessionAddress path runs (nothing auth is mocked); only the Next
 * cookies() jar is an in-memory store (unavoidable outside a live HTTP server). The revision is seeded through
 * the real pipeline with the RETAINED provider payloads (0 model calls). Gated + temp DB.
 */

const RUN = process.env.AUTH_ROUTE_TEST === "1";
const MODEL = "google/gemini-3.1-flash-lite-preview";
const ARCH = path.resolve("promotion-evidence/.private/closure-v2-architect-draft.json");
const CRIT = path.resolve("promotion-evidence/.private/closure-v2-critic-verdicts.json");

// in-memory cookie jar (Next request infra only) — the auth LOGIC around it is entirely real.
const store: Record<string, string> = {};
const jar = { get: (n: string) => (n in store ? { value: store[n] } : undefined), set: (n: string, v: string) => { store[n] = v; }, delete: (n: string) => { delete store[n]; } };
vi.mock("next/headers", () => ({ cookies: async () => jar }));
// fake ONLY the external effects for seeding the revision (0 model calls; retained payloads).
vi.mock("@/lib/launch/inspect", async (o) => ({ ...(await o<typeof import("@/lib/launch/inspect")>()), inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("@/lib/launch/field-test", async (o) => ({ ...(await o<typeof import("@/lib/launch/field-test")>()), fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("@/lib/launch/github", async (o) => ({ ...(await o<typeof import("@/lib/launch/github")>()), inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("@/lib/launch/inspection-replay", async (o) => ({ ...(await o<typeof import("@/lib/launch/inspection-replay")>()), runReplayShadow: vi.fn() }));
vi.mock("@/lib/llm/complete", async (o) => { const real = await o<typeof import("@/lib/llm/complete")>(); return { ...real, llmConfigured: () => true, llmCompleteJson: vi.fn() }; });
// P2 money sink: real settleApprovedSubmission (+ central permit) with settleWithRecovery as the money spy.
const { moneySpy } = vi.hoisted(() => ({ moneySpy: vi.fn(async () => ({ settled: true, txHash: "0xTX", recipient: `0x${"a".repeat(40)}`, amountBase: 1 })) }));
vi.mock("@/lib/campaigns/settle", () => ({ settleWithRecovery: moneySpy }));
vi.mock("@/lib/campaigns/reconcile", () => ({ reconcileVendorEvents: vi.fn(async () => null) }));
vi.mock("@/lib/telegram/bot", () => ({ announceCampaignSettled: vi.fn(), announceCampaignBlocked: vi.fn() }));
vi.mock("@/lib/telegram/founder-notify", () => ({ notifyFounderSettled: vi.fn() }));
vi.mock("@/lib/x402/fees", () => ({ chargeOperatorFee: vi.fn() }));

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { inspectProduct } from "@/lib/launch/inspect";
import { runFieldTest } from "@/lib/launch/field-test";
import { runReplayShadow } from "@/lib/launch/inspection-replay";
import { llmCompleteJson } from "@/lib/llm/complete";
import { deriveObservations } from "@/lib/launch/observed-facts";
import type { FieldTestState, FieldTestSummary, ProductObservation } from "@/lib/launch/schemas";

const stt = (o: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://reportly.test/", networkMethods: ["GET"], ...o });
const FT: FieldTestSummary = { ran: true, startUrl: "https://reportly.test/", mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10, states: [stt({ trigger: "initial load", visibleTextExcerpt: "Reportly dashboard", notableElements: [{ tag: "button", text: "Load report", role: "button" }], networkMethods: ["GET"] }), stt({ trigger: "clicked 'Load report'", url: "https://reportly.test/report", visibleTextExcerpt: "Report ready. Your report is ready to view.", notableElements: [{ tag: "heading", text: "Report ready", role: "heading" }], pixelDeltaPct: 45, networkMethods: ["GET"] })] };
const obs = (url: string): ProductObservation => ({ url, status: 200, title: "Reportly", headings: ["Reportly dashboard"], claims: [], ctas: ["Load report"], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Reportly dashboard. Load report. Report ready."], inspectedAt: 1, contentSha256: "a".repeat(64) });

/** REAL SIWE login for `account`: issue a genuine nonce, sign the exact message, run real verify+session. */
async function realLogin(account: ReturnType<typeof privateKeyToAccount>) {
  const { issueNonce, verifyAndCreateSession } = await import("@/lib/auth/session");
  const { buildSiweMessage } = await import("@/lib/auth/message");
  const nonce = await issueNonce(); // sets the httpOnly nonce cookie in the jar
  const issuedAt = new Date().toISOString();
  const message = buildSiweMessage({ address: account.address, nonce, issuedAt });
  const signature = await account.signMessage({ message });
  const addr = await verifyAndCreateSession({ address: account.address, signature, issuedAt }); // real viem verify + HMAC mint
  return addr; // the SESSION cookie now lives in the jar
}

async function postApprove(jobId: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/launch/[id]/approve/route");
  const req = new Request(`http://localhost/api/launch/${jobId}/approve`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const res = await POST(req as never, { params: Promise.resolve({ id: jobId }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe.runIf(RUN)("authenticated approval route — genuine SIWE", () => {
  beforeAll(() => { if (!fs.existsSync(ARCH) || !fs.existsSync(CRIT)) throw new Error("composition_evidence_unavailable"); });

  it("full matrix: genuine SIWE session gates POST /api/launch/[id]/approve", async () => {
    const founderKey = generatePrivateKey();
    const founder = privateKeyToAccount(founderKey);
    const wallet = founder.address.toLowerCase();

    process.env.MISSION_GROUNDING_MODE = "canary";
    process.env.MISSION_CANARY_ALLOWLIST = wallet;
    process.env.MISSION_MODEL = MODEL; process.env.MISSION_GROUNDING_CRITIC_MODEL = MODEL;
    process.env.INSPECTION_REPLAY_MODE = "shadow";

    const archDraft = JSON.parse(fs.readFileSync(ARCH, "utf8"));
    const critVerdicts = JSON.parse(fs.readFileSync(CRIT, "utf8"));
    const transId = deriveObservations(FT).transitions[0].id;
    vi.mocked(inspectProduct).mockResolvedValue({ startUrl: "https://reportly.test/", host: "reportly.test", observations: [obs("https://reportly.test/"), obs("https://reportly.test/report")], limitations: [], blocked: [] });
    vi.mocked(runFieldTest).mockResolvedValue(FT);
    vi.mocked(runReplayShadow).mockResolvedValue({ ran: true, probes: 1, byClassification: { reproduced: 1 }, records: [{ probeId: "p", transitionId: transId, classification: "reproduced" }] } as never);
    vi.mocked(llmCompleteJson).mockImplementation(async (o) => {
      const s = o.system ?? "";
      if (s.includes("GROUNDED mission architect")) return { json: archDraft.json, model: MODEL, provider: "commonstack", latencyMs: 1, promptTokens: 1, completionTokens: 1 } as never;
      if (s.includes("grounding CRITIC")) return { json: critVerdicts.json, model: MODEL, provider: "commonstack", latencyMs: 1, promptTokens: 1, completionTokens: 1 } as never;
      return { json: { missions: [{ missionKey: "legacy-x", title: "L", objective: "o", instructions: "1. s", targetSurface: "https://reportly.test/report" }] }, model: "legacy", provider: "legacy", latencyMs: 1, promptTokens: 0, completionTokens: 0 } as never;
    });

    const { createInspectionJob } = await import("@/lib/db/inspection");
    const { getCurrentRevision, getApprovedRevision, listRevisions, createRevision } = await import("@/lib/db/plan-revisions");
    const { runInspectionJob } = await import("@/lib/launch/job");
    const { deserializePlan } = await import("@/lib/launch/serde");

    let jobSeq = 0;
    // vary the productUrl per call so createInspectionJob's idempotency key differs each time (inspectProduct is
    // mocked to return the same reportly observations regardless of the url, so the plan is identical in shape).
    const mk = async () => { const n = ++jobSeq; const { job } = createInspectionJob({ founderWallet: wallet, publicCampaignId: "ar-" + n, productUrl: `https://reportly.test/?j=${n}`, repoUrl: null, goal: "Verify Load report reaches Report ready.", targetUsers: "u", totalBudgetBase: BigInt(3_000_000), tokenDecimals: 6, planningRequestId: `prid:test:ar-${n}`, surface: "test" }); await runInspectionJob(job.id); return job.id; };
    const jobId = await mk();
    const rev0 = getCurrentRevision(jobId)!;
    expect(rev0.reason).toBe("generated_grounded_v2");
    expect(rev0.verificationPolicyRequired).toBe(true);

    const codes: Record<string, number> = {};

    // (1) no session → 401
    delete store["sage_session"];
    codes.no_session = (await postApprove(jobId)).status;

    // (2) forged/malformed session → 401
    store["sage_session"] = "not.a.valid.token";
    codes.forged_session = (await postApprove(jobId)).status;
    delete store["sage_session"];

    // (3) valid session from a DIFFERENT wallet → 403
    const other = privateKeyToAccount(generatePrivateKey());
    await realLogin(other);
    codes.wrong_wallet = (await postApprove(jobId)).status;

    // Now authenticate as the REAL founder.
    const addr = await realLogin(founder);
    expect(addr!.toLowerCase()).toBe(wallet);

    // (4) stale revision (expectedRevision mismatch) → 409
    codes.stale_revision = (await postApprove(jobId, { expectedRevision: 99 })).status;

    // (5) session/body cannot override founder/revision/budget/plan/policy — malicious body is ignored → 200.
    codes.body_override_ignored = (await postApprove(jobId, { founder: other.address, revision: 99, totalBudgetBase: "1", missionPlanDigest: "0xhack", verificationPolicyDigest: "0xhack" })).status;
    // (6) replayed approval → idempotent, still 200, still exactly one approved revision.
    codes.replay = (await postApprove(jobId)).status;
    const approved = getApprovedRevision(jobId)!;
    const approvedCount = listRevisions(jobId).filter((r) => r.approvedAt != null).length;

    // tamper cases on FRESH jobs (each seeded real, then the stored revision row is corrupted).
    const { db } = await import("@/lib/db");
    const { planRevisions } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const tamperJob = async (mut: (rev: import("@/lib/db/schema").PlanRevision) => Record<string, unknown>) => { const jid = await mk(); const rv = getCurrentRevision(jid)!; db.update(planRevisions).set(mut(rv)).where(eq(planRevisions.id, rv.id)).run(); return jid; };

    // (7) changed policy digest → 409
    const jPolDigest = await tamperJob(() => ({ verificationPolicyDigest: "0xDIFFERENT" }));
    codes.changed_policy_digest = (await postApprove(jPolDigest)).status;
    // (8) required policy missing → 409
    const jNoPolicy = await tamperJob(() => ({ verificationPolicy: null }));
    codes.required_policy_missing = (await postApprove(jNoPolicy)).status;
    // (9) incomplete policy → 409
    const jIncomplete = await tamperJob((rv) => { const p = rv.verificationPolicy as { actionCriteria: { probeDigest: string }[]; policyDigest: string }; p.actionCriteria[0].probeDigest = ""; return { verificationPolicy: p }; });
    codes.incomplete_policy = (await postApprove(jIncomplete)).status;
    // (10) changed plan digest → 409 (verifyPlanForApproval recompute fails)
    const jPlan = await tamperJob((rv) => { const pl = deserializePlan(rv.planJson) as unknown as Record<string, unknown>; pl.missionPlanDigest = "0x" + "1".repeat(64); return { planJson: JSON.parse(JSON.stringify(pl, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) }; });
    codes.changed_plan_digest = (await postApprove(jPlan)).status;
    // (11) superseded revision → the current is the new one; approving the old via expectedRevision → 409.
    const jSup = await mk(); const rvOld = getCurrentRevision(jSup)!;
    createRevision({ jobId: jSup, authorWallet: wallet, reason: "edit", plan: deserializePlan(rvOld.planJson), budgetBase: BigInt(rvOld.budgetBase), validationOk: true });
    codes.superseded = (await postApprove(jSup, { expectedRevision: rvOld.revisionNumber })).status;

    // ── assertions ──
    expect(codes).toMatchObject({ no_session: 401, forged_session: 401, wrong_wallet: 403, stale_revision: 409, body_override_ignored: 200, replay: 200, changed_policy_digest: 409, required_policy_missing: 409, incomplete_policy: 409, changed_plan_digest: 409, superseded: 409 });
    expect(approvedCount).toBe(1); // replay never approved a second revision
    expect(approved.revisionNumber).toBe(rev0.revisionNumber);

    // immutable approval record carries the exact identity.
    const ar = approved.approvalRecord as Record<string, unknown>;
    expect((ar.approver as string).toLowerCase()).toBe(wallet);
    expect(ar.revision).toBe(rev0.revisionNumber);
    expect(ar.missionPlanDigest).toBe(rev0.missionPlanDigest);
    expect(ar.verificationPolicyDigest).toBe(rev0.verificationPolicyDigest);
    expect(ar.totalBudgetBase).toBe("3000000");
    expect(ar.model).toBeTruthy(); expect(ar.provider).toBeTruthy();

    const trace = { artifact: "authenticated-approval-route", ephemeralWallet: wallet, statusCodes: codes, approvedRevision: approved.revisionNumber, approvedCount, missionPlanDigest: rev0.missionPlanDigest, verificationPolicyDigest: rev0.verificationPolicyDigest, authenticatedApprovalRouteProven: true };
    fs.writeFileSync(path.resolve("promotion-evidence/authenticated-approval-route.json"), JSON.stringify(trace, null, 2));
    console.log("[auth-route] proven — matrix:", JSON.stringify(codes));

    // ── P2 — route-to-money: the AUTHENTICATED approved revision continues to the money sink ──
    const { createCampaign, getCampaign, updateCampaignV2Plan } = await import("@/lib/db/campaigns");
    const { attachApprovedPolicyToCampaign } = await import("@/lib/campaigns/attach-policy");
    const { loadVerifiedCampaignPolicy } = await import("@/lib/deputy/verification-policy");
    const { settleApprovedSubmission } = await import("@/lib/campaigns/settle-flow");
    const { memReplayJournal } = await import("@/lib/deputy/policy-test-fixtures");
    const { getAddress } = await import("viem");
    const { nowSeconds } = await import("@/lib/db/keys");
    const { missions } = await import("@/lib/db/schema");

    const camp = createCampaign({ title: "AR", descriptionMd: "", criteria: [], conditionType: "approval", onchainCheck: null, rewardAmount: 1, maxRecipients: 1, vaultAddress: getAddress(`0x${"1".repeat(40)}`), posterWallet: wallet, ownerIsSage: true, status: "live", autonomy: "autopilot", autopilotThreshold: 0.85 } as never);
    updateCampaignV2Plan(camp.id, { vaultKind: "campaign_v2", campaignIdHash: rev0.campaignIdHash, missionPlanDigest: rev0.missionPlanDigest, commitmentVersion: 2 });
    expect(attachApprovedPolicyToCampaign(camp.id, jobId)).toMatchObject({ ok: true, attached: true }); // uses the AUTHENTICATED-approved revision
    const campaign = getCampaign(camp.id)!;
    const loaded = loadVerifiedCampaignPolicy(campaign);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const probeDigest = loaded.policy.probes[0].probeDigest;
    const missionKey = loaded.policy.actionCriteria[0].missionKey;
    db.insert(missions).values({ id: "m1", campaignId: camp.id, missionKey, missionIdHash: "0xM", title: "t", descriptionMd: "", targetSurface: "https://reportly.test/report", rewardAmount: 1, maxCompletions: 1, missionSpecDigest: "0x", verifiabilityClass: "observation-based", createdAt: nowSeconds(), updatedAt: nowSeconds() } as never).run();
    const sub = { id: "sub-ar", campaignId: camp.id, missionIdHash: "0xM", wallet: `0x${"a".repeat(40)}`, status: "approved" } as never;
    const mkJournal = (o: { code: string; decision: "allow" | "hold"; now?: () => number }) => { const j = memReplayJournal(o.now ? { now: o.now } : {}); const l = j.begin("sub-ar", loaded.policy.policyDigest, probeDigest); j.complete(l.runId, "sub-ar", loaded.policy.policyDigest, probeDigest, { decision: o.decision, code: o.code, latencyMs: 1 }); return j; };
    process.env.PAYOUT_ACTION_REPLAY_MODE = "canary";
    const settle = (j: unknown) => settleApprovedSubmission(campaign, sub, { payoutReplay: { journal: j } } as never);
    const spyCounts: Record<string, number> = {};
    moneySpy.mockClear(); await settle(mkJournal({ code: "reproduced", decision: "allow" })); spyCounts.freshReproduced = moneySpy.mock.calls.length;
    moneySpy.mockClear(); await settle(mkJournal({ code: "wrong_after_state", decision: "hold" })); spyCounts.drift = moneySpy.mock.calls.length;
    moneySpy.mockClear(); await settle(mkJournal({ code: "reproduced", decision: "allow", now: () => Math.floor(Date.now() / 1000) - 400 })); spyCounts.stale = moneySpy.mock.calls.length;
    moneySpy.mockClear(); const tc = getCampaign(camp.id)!; (tc.verificationPolicy as { probes: { expected: { addedTexts: string[] } }[] }).probes[0].expected.addedTexts = ["x"]; await settleApprovedSubmission(tc, sub, { payoutReplay: { journal: mkJournal({ code: "reproduced", decision: "allow" }) } } as never); spyCounts.tamper = moneySpy.mock.calls.length;
    moneySpy.mockClear(); delete process.env.PAYOUT_ACTION_REPLAY_MODE; await settle(mkJournal({ code: "reproduced", decision: "allow" })); spyCounts.covenantFrozen = moneySpy.mock.calls.length;
    expect(spyCounts).toEqual({ freshReproduced: 1, drift: 0, stale: 0, tamper: 0, covenantFrozen: 0 });
    fs.writeFileSync(path.resolve("promotion-evidence/authenticated-approval-route.json"), JSON.stringify({ ...trace, routeToMoneySpyCounts: spyCounts }, null, 2));
    console.log("[auth-route] route→money spy:", JSON.stringify(spyCounts));
  }, 120_000);
});
