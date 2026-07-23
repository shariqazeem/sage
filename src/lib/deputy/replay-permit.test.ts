import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/**
 * Phase 5 — the CENTRAL replay permit at settleApprovedSubmission (the sole broadcast sink). Proven with the
 * REAL settleApprovedSubmission + a settleWithRecovery SPY: no path reaches settleWithRecovery without a
 * complete, reproduced permit for the exact digests. This dominates the deputy, cron, and manual routes alike.
 */

const { settleWithRecovery } = vi.hoisted(() => ({ settleWithRecovery: vi.fn(async () => ({ settled: true, txHash: "0xTX", recipient: `0x${"a".repeat(40)}`, amountBase: 1 })) }));
vi.mock("@/lib/campaigns/settle", () => ({ settleWithRecovery }));
vi.mock("@/lib/db/campaigns", () => ({ getMissionByHash: vi.fn(), recordEventOnce: vi.fn(() => ({ inserted: true })), updateSubmission: vi.fn() }));
vi.mock("@/lib/deputy/chain", () => ({ getVaultState: vi.fn(async () => ({ budget: 0, spent: 0, remaining: 0 })) }));
vi.mock("@/lib/campaigns/reconcile", () => ({ reconcileVendorEvents: vi.fn(async () => null) }));
vi.mock("@/lib/telegram/bot", () => ({ announceCampaignSettled: vi.fn(), announceCampaignBlocked: vi.fn() }));
vi.mock("@/lib/telegram/founder-notify", () => ({ notifyFounderSettled: vi.fn() }));
vi.mock("@/lib/x402/fees", () => ({ chargeOperatorFee: vi.fn() }));

import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { getMissionByHash } from "@/lib/db/campaigns";
import { makeV2Policy, v2Campaign, legacyCampaign, memReplayJournal } from "./policy-test-fixtures";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { ReplayJournalHandle } from "@/lib/db/payout-replay-journal";

const MODE = "PAYOUT_ACTION_REPLAY_MODE";
const submission = { id: "s1", campaignId: "c1", missionIdHash: "0xM", wallet: `0x${"a".repeat(40)}`, status: "approved" } as unknown as Submission;
const policy = makeV2Policy();
const probeDigest = policy.probes[0].probeDigest;

beforeEach(() => { settleWithRecovery.mockClear(); vi.mocked(getMissionByHash).mockReturnValue({ missionKey: "m-load" } as never); });
afterEach(() => { delete process.env[MODE]; });

function settle(campaign: Campaign, journal: ReplayJournalHandle) {
  return settleApprovedSubmission(campaign, submission, { payoutReplay: { journal } } as never);
}
function permitFor(reproduced: boolean): ReplayJournalHandle {
  const j = memReplayJournal();
  j.begin(submission.id, policy.policyDigest, probeDigest);
  j.complete(submission.id, policy.policyDigest, probeDigest, { decision: reproduced ? "allow" : "hold", code: reproduced ? "reproduced" : "wrong_after_state", latencyMs: 1 });
  return j;
}

describe("verifyReplayPermit at settleApprovedSubmission — fail closed at the money sink", () => {
  it("canary + required + NO permit (empty journal) → settleWithRecovery NEVER called", async () => {
    process.env[MODE] = "canary";
    const r = await settle(v2Campaign(), memReplayJournal());
    expect(settleWithRecovery).not.toHaveBeenCalled();
    expect(r.outcome.settled).toBe(false);
    expect((r.outcome as { reason: string }).reason).toContain("action_replay_permit_denied:replay_not_completed");
  });
  it("canary + required + VETO permit → NEVER settles", async () => {
    process.env[MODE] = "canary";
    const r = await settle(v2Campaign(), permitFor(false));
    expect(settleWithRecovery).not.toHaveBeenCalled();
    expect((r.outcome as { reason: string }).reason).toContain("replay_veto");
  });
  it("canary + required + permit for a DIFFERENT (stale) policy digest → never settles", async () => {
    process.env[MODE] = "canary";
    const j = memReplayJournal();
    j.begin(submission.id, "0xSTALE", probeDigest);
    j.complete(submission.id, "0xSTALE", probeDigest, { decision: "allow", code: "reproduced", latencyMs: 1 });
    await settle(v2Campaign(), j);
    expect(settleWithRecovery).not.toHaveBeenCalled();
  });
  it("canary + required + EXACT complete reproduced permit → settles ONCE", async () => {
    process.env[MODE] = "canary";
    await settle(v2Campaign(), permitFor(true));
    expect(settleWithRecovery).toHaveBeenCalledTimes(1);
  });
  it("NON-required legacy campaign (no policy) + any mode → historical settle", async () => {
    process.env[MODE] = "canary";
    await settle(legacyCampaign(), memReplayJournal());
    expect(settleWithRecovery).toHaveBeenCalledTimes(1);
    delete process.env[MODE];
    await settle(legacyCampaign(), memReplayJournal());
    expect(settleWithRecovery).toHaveBeenCalledTimes(2);
  });
  it("IMMUTABLE COVENANT: required + off / shadow / unknown → FROZEN (never settles)", async () => {
    for (const m of ["off", "shadow", "enforce", "banana"]) {
      if (m === "off") delete process.env[MODE]; else process.env[MODE] = m;
      settleWithRecovery.mockClear();
      const r = await settle(v2Campaign(), permitFor(true)); // even WITH a reproduced permit
      expect(settleWithRecovery).not.toHaveBeenCalled();
      expect((r.outcome as { reason: string }).reason).toContain("covenant_frozen");
    }
  });
  it("INCONSISTENT: a policy attached while required=false → fail closed (never settles)", async () => {
    process.env[MODE] = "canary";
    const bad = v2Campaign({ verificationPolicyRequired: false }); // has a policy but not marked required
    const r = await settle(bad, memReplayJournal());
    expect(settleWithRecovery).not.toHaveBeenCalled();
    expect((r.outcome as { reason: string }).reason).toContain("inconsistent:policy_without_required");
  });
  it("covenant metadata incomplete (missing version/source-revision) → fail closed", async () => {
    process.env[MODE] = "canary";
    await settle(v2Campaign({ verificationPolicyVersion: null }), permitFor(true));
    expect(settleWithRecovery).not.toHaveBeenCalled();
    await settle(v2Campaign({ policySourceRevisionNumber: null }), permitFor(true));
    expect(settleWithRecovery).not.toHaveBeenCalled();
  });
  it("canary + required + tampered campaign policy → fail closed (never settles)", async () => {
    process.env[MODE] = "canary";
    const c = v2Campaign();
    (c.verificationPolicy as { probes: { expected: { addedTexts: string[] } }[] }).probes[0].expected.addedTexts = ["x"];
    await settle(c, permitFor(true));
    expect(settleWithRecovery).not.toHaveBeenCalled();
  });
  it("canary + required + partial permit (one of two probes reproduced) → never settles", async () => {
    process.env[MODE] = "canary";
    // a two-probe policy; only one probe has a reproduced permit → incomplete → fail closed.
    // (single-probe fixture: emulate "partial" by a permit whose probeDigest doesn't match the required one.)
    const j = memReplayJournal();
    j.begin(submission.id, policy.policyDigest, "0xWRONGPROBE");
    j.complete(submission.id, policy.policyDigest, "0xWRONGPROBE", { decision: "allow", code: "reproduced", latencyMs: 1 });
    await settle(v2Campaign(), j);
    expect(settleWithRecovery).not.toHaveBeenCalled();
  });
});
