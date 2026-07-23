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
import { verifyReplayPermit } from "./replay-permit";
import { getMissionByHash } from "@/lib/db/campaigns";
import { makeV2Policy, v2Campaign, legacyCampaign, memReplayJournal } from "./policy-test-fixtures";
import type { Campaign, Submission } from "@/lib/db/schema";
import { REPLAY_RUNNER_VERSION, type ReplayJournalHandle, type ReplayJournalLookup } from "@/lib/db/payout-replay-journal";

const MODE = "PAYOUT_ACTION_REPLAY_MODE";
const submission = { id: "s1", campaignId: "c1", missionIdHash: "0xM", wallet: `0x${"a".repeat(40)}`, status: "approved" } as unknown as Submission;
const policy = makeV2Policy();
const probeDigest = policy.probes[0].probeDigest;

beforeEach(() => { settleWithRecovery.mockClear(); vi.mocked(getMissionByHash).mockReturnValue({ missionKey: "m-load" } as never); });
afterEach(() => { delete process.env[MODE]; });

function settle(campaign: Campaign, journal: ReplayJournalHandle) {
  return settleApprovedSubmission(campaign, submission, { payoutReplay: { journal } } as never);
}
function permitFor(reproduced: boolean, now?: () => number): ReplayJournalHandle {
  const j = memReplayJournal(now ? { now } : {});
  const lease = j.begin(submission.id, policy.policyDigest, probeDigest);
  j.complete(lease.runId, submission.id, policy.policyDigest, probeDigest, { decision: reproduced ? "allow" : "hold", code: reproduced ? "reproduced" : "wrong_after_state", latencyMs: 1 });
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
    const l1 = j.begin(submission.id, "0xSTALE", probeDigest);
    j.complete(l1.runId, submission.id, "0xSTALE", probeDigest, { decision: "allow", code: "reproduced", latencyMs: 1 });
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
    const l2 = j.begin(submission.id, policy.policyDigest, "0xWRONGPROBE");
    j.complete(l2.runId, submission.id, policy.policyDigest, "0xWRONGPROBE", { decision: "allow", code: "reproduced", latencyMs: 1 });
    await settle(v2Campaign(), j);
    expect(settleWithRecovery).not.toHaveBeenCalled();
  });
});

// P4 — fresh, lease-bound permits (direct verifyReplayPermit with an injected clock + controllable journal).
describe("verifyReplayPermit — P4 freshness + lease", () => {
  const NOW = 1_000_000;
  const rec = (over: Partial<ReplayJournalLookup>): ReplayJournalLookup => ({ decision: "allow", code: "reproduced", completed: true, attempt: 1, runId: "r1", completedAt: NOW, probeVersion: REPLAY_RUNNER_VERSION, ...over });
  const fakeJournal = (r: ReplayJournalLookup | null): ReplayJournalHandle => ({ lookup: () => r, begin: () => ({ runId: "x", attempt: 1 }), complete: () => true });
  beforeEach(() => { process.env[MODE] = "canary"; vi.mocked(getMissionByHash).mockReturnValue({ missionKey: "m-load" } as never); });

  it("fresh exact reproduced → ok", () => {
    expect(verifyReplayPermit(v2Campaign(), submission, fakeJournal(rec({})), NOW).ok).toBe(true);
  });
  it("STALE (completed > 5 min ago) → not ok (permit_stale)", () => {
    expect(verifyReplayPermit(v2Campaign(), submission, fakeJournal(rec({ completedAt: NOW - 301 })), NOW)).toEqual({ ok: false, reason: "permit_stale" });
  });
  it("RUNNER-VERSION mismatch → not ok (runner_version_stale)", () => {
    expect(verifyReplayPermit(v2Campaign(), submission, fakeJournal(rec({ probeVersion: "old-runner" })), NOW)).toEqual({ ok: false, reason: "runner_version_stale" });
  });
  it("IN-FLIGHT / ambiguous (not completed) → not ok (replay_not_completed)", () => {
    expect(verifyReplayPermit(v2Campaign(), submission, fakeJournal(rec({ completed: false, completedAt: null })), NOW)).toEqual({ ok: false, reason: "replay_not_completed" });
  });
  it("LEASE CAS: a late completion of run N cannot overwrite run N+1", () => {
    const j = memReplayJournal({ now: () => NOW });
    const l1 = j.begin("s", "p", "pr");         // run N
    const l2 = j.begin("s", "p", "pr");         // run N+1 (supersedes; resets to in-flight)
    const late = j.complete(l1.runId, "s", "p", "pr", { decision: "allow", code: "reproduced", latencyMs: 1 }); // late N
    expect(late).toBe(false);                    // CAS refused
    expect(j.lookup("s", "p", "pr")!.completed).toBe(false); // still in-flight under l2
    const ok = j.complete(l2.runId, "s", "p", "pr", { decision: "allow", code: "reproduced", latencyMs: 1 }); // current N+1
    expect(ok).toBe(true);
  });
});
