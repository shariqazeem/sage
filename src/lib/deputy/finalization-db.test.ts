import { afterEach, describe, expect, it } from "vitest";
import { seedV2Campaign, payBrief } from "@/lib/campaigns/campaign-v2.fixture";
import { createSubmission, insertDecision, recordEvent } from "@/lib/db/campaigns";
import { finalizationFor } from "./finalization-db";

/**
 * The finalization window against a real (in-memory) ledger: an agent approval waits out its
 * window, a founder's release does not, and a near-identical report that arrives AFTER the approval
 * revokes it — which is the whole point of waiting.
 */
const decisionFor = (submissionId: string, campaignId: string) =>
  insertDecision({
    submissionId,
    campaignId,
    engine: "llm",
    model: "test",
    brief: payBrief(),
    contentSha256: null,
    evidenceOk: true,
    latencyMs: null,
    costUsd: null,
    x402PaymentTx: null,
    x402Status: "not_required",
    x402Reason: null,
  });

describe("finalizationFor — the window on a real ledger", () => {
  afterEach(() => { process.env.AUTOPAY_FINALIZE_MINUTES = "0"; });

  it("an agent approval waits out the window, then finalizes when nothing objects", () => {
    process.env.AUTOPAY_FINALIZE_MINUTES = "30";
    const f = seedV2Campaign();
    const now = 1_800_000_000;
    recordEvent({ campaignId: f.campaign.id, submissionId: f.submission.id, kind: "autopay_approved", detail: "approved", createdAt: now - 600 });
    expect(finalizationFor(f.submission, "listed", now)).toEqual({ state: "waiting", finalizesAt: now - 600 + 1800 });
    expect(finalizationFor(f.submission, "listed", now + 1800)).toEqual({ state: "finalize" });
  });

  it("a founder's release newer than the agent's approval settles now", () => {
    process.env.AUTOPAY_FINALIZE_MINUTES = "30";
    const f = seedV2Campaign({ wallet: `0x${"c".repeat(40)}` });
    const now = 1_800_000_000;
    recordEvent({ campaignId: f.campaign.id, submissionId: f.submission.id, kind: "autopay_approved", detail: "approved", createdAt: now - 60 });
    recordEvent({ campaignId: f.campaign.id, submissionId: f.submission.id, kind: "submission_approved", detail: "released", createdAt: now - 30 });
    expect(finalizationFor(f.submission, "listed", now)).toEqual({ state: "release" });
  });

  it("a near-identical report that arrives after the approval revokes it, with the reason", () => {
    const f = seedV2Campaign({ wallet: `0x${"d".repeat(40)}` });
    const note = "I opened the privacy page and read about the Cairo vault, the Poseidon commitment and the one-time claim link that pays gas for the worker.";
    const created = createSubmission({ campaignId: f.campaign.id, wallet: `0x${"e".repeat(40)}`, note, missionIdHash: f.mission.missionIdHash });
    if (!created.ok) throw new Error(created.error);
    const a = created;
    decisionFor(a.submission.id, f.campaign.id);
    const now = 1_800_000_000;
    recordEvent({ campaignId: f.campaign.id, submissionId: a.submission.id, kind: "autopay_approved", detail: "approved", createdAt: now - 3600 });
    // arrives AFTER the approval, from another wallet
    createSubmission({ campaignId: f.campaign.id, wallet: `0x${"f".repeat(40)}`, note: `${note} Also true.`, missionIdHash: f.mission.missionIdHash });
    const r = finalizationFor(a.submission, "listed", now);
    expect(r.state).toBe("revoke");
    if (r.state === "revoke") expect(r.reason).toMatch(/revoked in the finalization window — .*near-identical/);
  });
});
