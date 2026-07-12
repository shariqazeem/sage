import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for f1af9bf + 02E.1 Part A: a V2 mission submission is judged against
 * the LOCKED MISSION's context (criteria + instructions + evidence requirements),
 * never empty campaign criteria; the decision records its mission provenance; and a
 * missing mission fails closed (HOLD). V1 behavior is unchanged. Reward is never in
 * the judged input (settlement policy, not evidence quality).
 */

vi.mock("@/lib/deputy/brain", () => ({ verifySubmission: vi.fn() }));
vi.mock("@/lib/x402/verify-evidence", () => ({ verifyEvidence: vi.fn() }));

import { ensureDecision } from "./decisions";
import { verifySubmission } from "./brain";
import { verifyEvidence } from "@/lib/x402/verify-evidence";
import {
  createCampaign,
  createMission,
  createSubmission,
  getDecisionBySubmission,
  lockMissionPlan,
  updateCampaignV2Plan,
} from "@/lib/db/campaigns";
import { campaignIdHash, missionIdHash } from "@/lib/campaigns/mission-plan";
import type { DecisionBrief } from "./brain-core";

const payBrief: DecisionBrief = {
  engine: "llm",
  model: "gemini",
  provider: "api.commonstack.ai",
  criteria: [{ criterion: "phrase present", met: true, confidence: 0.97, quote: "SAGE_V2_AI_PIPELINE_OK" }],
  fraudSignals: [],
  recommendation: "pay",
  reasonCode: "all_criteria_met",
  confidence: 0.97,
  summary: "ok",
  evidenceOk: true,
  contentSha256: "a".repeat(64),
  latencyMs: 100,
  costUsd: 0.0003,
  x402PaymentTx: null,
  x402Status: "not_required",
  x402Reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyEvidence).mockResolvedValue({
    text: "evidence contains SAGE_V2_AI_PIPELINE_OK",
    contentSha256: "a".repeat(64),
    ok: true,
    failReason: undefined,
    x402PaymentTx: null,
    x402Status: "not_required",
    x402Reason: null,
  } as never);
  vi.mocked(verifySubmission).mockResolvedValue(payBrief);
});

function seedV2(opts?: { withMission?: boolean; lock?: boolean; identity?: boolean }) {
  const c = createCampaign({
    title: "V2 campaign",
    rewardAmount: 100_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${"2".repeat(40)}`,
    chainId: 59902,
    vaultKind: "campaign_v2",
    criteria: [], // V2 campaign has NO campaign-level criteria
  });
  const cid = campaignIdHash(c.id);
  if (opts?.identity !== false) {
    updateCampaignV2Plan(c.id, {
      vaultKind: "campaign_v2",
      campaignIdHash: cid,
      missionPlanDigest: `0x${"9".repeat(64)}`,
      commitmentVersion: 2,
    });
  }
  const mid = missionIdHash(c.id, "verify");
  if (opts?.withMission !== false) {
    createMission({
      campaignId: c.id,
      missionKey: "verify",
      missionIdHash: mid,
      title: "Verify the fixture",
      objective: "Confirm the page contains the phrase",
      instructions: "Open the URL and locate the phrase SAGE_V2_AI_PIPELINE_OK",
      targetSurface: "https://example.com/fixture",
      criteria: ["The fetched evidence contains SAGE_V2_AI_PIPELINE_OK"],
      evidenceList: ["The source URL", "The exact quoted phrase"],
      rewardAmount: 100_000,
      maxCompletions: 1,
      status: "draft",
      displayOrder: 0,
    });
    if (opts?.lock !== false) lockMissionPlan(c.id, cid);
  }
  const r = createSubmission({ campaignId: c.id, wallet: `0x${"e".repeat(40)}`, evidenceUrl: "https://example.com/fixture", missionIdHash: mid });
  if (!r.ok) throw new Error("seed sub failed");
  return { campaignId: c.id, cid, mid, submissionId: r.submission.id };
}

describe("V2 decision judges against the locked mission (Part A)", () => {
  it("uses the mission's criteria, NOT empty campaign criteria", async () => {
    const f = seedV2();
    await ensureDecision(f.submissionId);
    const input = vi.mocked(verifySubmission).mock.calls[0][0];
    expect(input.criteria).toContain("The fetched evidence contains SAGE_V2_AI_PIPELINE_OK");
    expect(input.criteria).not.toHaveLength(0); // never judged against nothing
    expect(input.campaignTitle).toContain("Verify the fixture");
    expect(input.campaignTitle).toContain("Confirm the page contains the phrase"); // objective
  });

  it("the instructions and evidence requirements reach the decision input", async () => {
    const f = seedV2();
    await ensureDecision(f.submissionId);
    const input = vi.mocked(verifySubmission).mock.calls[0][0];
    expect(input.criteria.some((c) => c.includes("Open the URL and locate the phrase"))).toBe(true); // instructions
    expect(input.criteria).toContain("Required evidence: The source URL");
    expect(input.criteria).toContain("Required evidence: The exact quoted phrase");
    // reward is NEVER in the judged input
    expect(input.criteria.join(" ")).not.toContain("100000");
    expect(input.criteria.join(" ").toLowerCase()).not.toContain("reward");
  });

  it("records the mission provenance (missionIdHash + missionSpecDigest) on the decision", async () => {
    const f = seedV2();
    await ensureDecision(f.submissionId);
    const d = getDecisionBySubmission(f.submissionId)!;
    expect(d.commitmentVersion).toBe(2);
    expect(d.vaultKind).toBe("campaign_v2");
    expect(d.missionIdHash).toBe(f.mid);
    expect(d.missionSpecDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("FAILS CLOSED (HOLD) when the locked mission is missing — never judges against nothing", async () => {
    const f = seedV2({ withMission: false });
    const brief = await ensureDecision(f.submissionId);
    expect(brief?.recommendation).toBe("hold");
    expect(brief?.engine).toBe("heuristic"); // never the LLM, never auto-pays
    expect(verifySubmission).not.toHaveBeenCalled();
    const d = getDecisionBySubmission(f.submissionId)!;
    expect(d.missionIdHash).toBe(f.mid); // provenance still recorded
  });

  it("FAILS CLOSED when the campaign lacks its on-chain identity", async () => {
    const f = seedV2({ identity: false });
    const brief = await ensureDecision(f.submissionId);
    expect(brief?.recommendation).toBe("hold");
    expect(verifySubmission).not.toHaveBeenCalled();
  });
});

describe("V1 decision behavior is unchanged", () => {
  it("a V1 submission judges against the campaign's own criteria + title", async () => {
    const c = createCampaign({
      title: "V1 campaign",
      rewardAmount: 500_000,
      vaultAddress: `0x${"1".repeat(40)}`,
      posterWallet: `0x${"2".repeat(40)}`,
      chainId: 59902,
      criteria: ["ship the fix"],
    });
    const r = createSubmission({ campaignId: c.id, wallet: `0x${"a".repeat(40)}`, evidenceUrl: "https://example.com/x" });
    if (!r.ok) throw new Error("seed");
    await ensureDecision(r.submission.id);
    const input = vi.mocked(verifySubmission).mock.calls[0][0];
    expect(input.campaignTitle).toBe("V1 campaign");
    expect(input.criteria).toEqual(["ship the fix"]);
    const d = getDecisionBySubmission(r.submission.id)!;
    expect(d.commitmentVersion).toBe(1);
    expect(d.missionIdHash).toBeNull();
  });
});
