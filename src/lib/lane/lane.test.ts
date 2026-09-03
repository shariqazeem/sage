import { afterEach, describe, expect, it } from "vitest";
import { seedV2Campaign, payBrief } from "@/lib/campaigns/campaign-v2.fixture";
import { casSubmissionStatus, createSubmission, insertDecision, recordEvent, updateSubmission } from "@/lib/db/campaigns";
import { laneFor } from "./lane";

/**
 * The settling lane reads the same ledger the sweep acts on: a ticket's clock is the
 * autopay_approved event plus the window, and its lights are the sweep's own checks, run now.
 */
const decisionFor = (submissionId: string, campaignId: string) =>
  insertDecision({ submissionId, campaignId, engine: "llm", model: "test", brief: payBrief(), contentSha256: null, evidenceOk: true, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null });

describe("laneFor — the settling lane on a real ledger", () => {
  afterEach(() => { process.env.AUTOPAY_FINALIZE_MINUTES = "0"; });

  it("an approved payout is a ticket with its clock and three clear lights", () => {
    process.env.AUTOPAY_FINALIZE_MINUTES = "30";
    const f = seedV2Campaign();
    const now = 1_800_000_000;
    decisionFor(f.submission.id, f.campaign.id);
    expect(casSubmissionStatus(f.submission.id, "pending", "approved")).toBe(true);
    recordEvent({ campaignId: f.campaign.id, submissionId: f.submission.id, kind: "autopay_approved", detail: "approved", createdAt: now - 600 });
    const [t] = laneFor([f.campaign], now);
    expect(t).toMatchObject({ state: "approved", approvedAt: now - 600, finalizesAt: now - 600 + 1800, windowSec: 1800, lights: { nearDup: "clear", copied: "clear", cluster: "clear" }, reason: null });
  });

  it("a near-identical report arriving inside the window lights the dup lamp and names the reason", () => {
    process.env.AUTOPAY_FINALIZE_MINUTES = "30";
    const f = seedV2Campaign({ wallet: `0x${"a".repeat(40)}` });
    const note = "I opened the privacy page and read about the Cairo vault, the Poseidon commitment and the one-time claim link that pays gas for the worker.";
    const created = createSubmission({ campaignId: f.campaign.id, wallet: `0x${"b".repeat(40)}`, note, missionIdHash: f.mission.missionIdHash });
    if (!created.ok) throw new Error(created.error);
    decisionFor(created.submission.id, f.campaign.id);
    casSubmissionStatus(created.submission.id, "pending", "approved");
    const now = 1_800_000_000;
    recordEvent({ campaignId: f.campaign.id, submissionId: created.submission.id, kind: "autopay_approved", detail: "approved", createdAt: now - 60 });
    createSubmission({ campaignId: f.campaign.id, wallet: `0x${"c".repeat(40)}`, note: `${note} Also true.`, missionIdHash: f.mission.missionIdHash });
    const t = laneFor([f.campaign], now).find((x) => x.id === created.submission.id);
    expect(t?.lights?.nearDup).toBe("flag");
    expect(t?.reason).toMatch(/near-identical|duplicate/i);
  });

  it("a payout that went through the lane stays on it as paid, with its receipt; one never approved by the agent does not appear", () => {
    const f = seedV2Campaign({ wallet: `0x${"d".repeat(40)}` });
    const now = 1_800_000_000;
    recordEvent({ campaignId: f.campaign.id, submissionId: f.submission.id, kind: "autopay_approved", detail: "approved", createdAt: now - 3000 });
    casSubmissionStatus(f.submission.id, "pending", "settling");
    casSubmissionStatus(f.submission.id, "settling", "paid");
    updateSubmission(f.submission.id, { payoutTx: `0x${"1".repeat(64)}`, decidedAt: now - 1200 });
    const lane = laneFor([f.campaign], now);
    expect(lane.map((t) => [t.state, t.txHash])).toEqual([["paid", `0x${"1".repeat(64)}`]]);
  });
});
