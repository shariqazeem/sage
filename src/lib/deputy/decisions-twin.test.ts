import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deputy/brain", () => ({ verifySubmission: vi.fn() }));
vi.mock("@/lib/x402/verify-evidence", () => ({ verifyEvidence: vi.fn() }));
vi.mock("./work-proof", async (importOriginal) => {
  const real = await importOriginal<typeof import("./work-proof")>();
  return {
    ...real,
    runWorkProof: vi.fn(async () => ({
      outcome: "verified",
      result: { verified: true, strength: "strong", detail: "artifact live + tester-marked", publicDetail: "Verified." },
      report:
        "=== SAGE WORK-PROOF VERIFICATION (server-side deterministic check — not submitter-authored) ===\nKIND: created artifact · STRENGTH: strong · RESULT: PASSED",
    })),
  };
});

import { ensureDecision } from "./decisions";
import { verifySubmission } from "./brain";
import { verifyEvidence } from "@/lib/x402/verify-evidence";
import { createCampaign, createMission, createSubmission, getSubmission, updateCampaignV2Plan } from "@/lib/db/campaigns";
import { campaignIdHash, computeCampaignPlan, missionIdHash } from "@/lib/campaigns/mission-plan";
import type { DecisionBrief } from "./brain-core";

/**
 * ARTIFACT TWIN CHECK (FC Phase 1) — the marker-swap collusion closer. The wallet marker binds an
 * artifact to its submitter but is blind to the SAME page resubmitted by a second wallet with only
 * the address changed. These tests pin: the second wallet's clone is HELD deterministically (no
 * model call spent), the fingerprint ignores addresses/case/whitespace, and genuinely different
 * content still reaches the judge.
 */

const payBrief: DecisionBrief = {
  engine: "llm",
  model: "gemini",
  provider: "api.commonstack.ai",
  criteria: [],
  fraudSignals: [],
  recommendation: "pay",
  reasonCode: "all_criteria_met",
  confidence: 0.95,
  summary: "ok",
  evidenceOk: true,
  contentSha256: "a".repeat(64),
  latencyMs: 5,
  costUsd: 0.0001,
  x402PaymentTx: null,
  x402Status: "not_required",
  x402Reason: null,
};

let n = 0;
function seedGig() {
  const c = createCampaign({
    title: `twin-gig-${++n}`,
    rewardAmount: 500_000,
    vaultAddress: `0x${"3".repeat(40)}`,
    posterWallet: `0x${"4".repeat(40)}`,
    chainId: 2345,
    vaultKind: "campaign_v2",
    criteria: [],
  });
  const cid = campaignIdHash(c.id);
  const planDigest = computeCampaignPlan(c.id, [
    { missionKey: "deliver", rewardBase: BigInt(500_000), maxCompletions: BigInt(3) },
  ]).missionPlanDigest;
  updateCampaignV2Plan(c.id, { vaultKind: "campaign_v2", campaignIdHash: cid, missionPlanDigest: planDigest, commitmentVersion: 2 });
  const mid = missionIdHash(c.id, "deliver");
  createMission({
    campaignId: c.id,
    missionKey: "deliver",
    missionIdHash: mid,
    title: "Publish your deliverable page",
    objective: "Deliverable: publish the page",
    instructions: "Publish the page on paste.rs carrying your wallet.",
    targetSurface: "https://sagepays.xyz",
    criteria: ["The page contains the translated menu"],
    evidenceList: ["The link"],
    verifiabilityClass: "url-verifiable",
    verificationContract: { kind: "artifact_url", allowedHosts: ["paste.rs"], markerKind: "wallet" },
    rewardAmount: 500_000,
    maxCompletions: 3,
    displayOrder: 0,
  });
  return { c, mid };
}

function submitAs(campaignId: string, mid: string, wallet: string, url: string) {
  const r = createSubmission({ campaignId, wallet, evidenceUrl: url, note: "done", missionIdHash: mid, missionSpecDigest: null });
  if (!r.ok) throw new Error(`seed failed: ${r.error}`);
  return r.submission.id;
}

const fetchedAs = (text: string) =>
  vi.mocked(verifyEvidence).mockResolvedValue({
    text,
    contentSha256: "b".repeat(64),
    ok: true,
    failReason: undefined,
    x402PaymentTx: null,
    x402Status: "not_required",
    x402Reason: null,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifySubmission).mockResolvedValue(payBrief);
});

describe("artifact twin check — deterministic, pre-judge", () => {
  it("holds the marker-swap clone without a model call; fingerprints ignore address, case, whitespace", async () => {
    const { c, mid } = seedGig();

    const a = submitAs(c.id, mid, `0x${"a".repeat(40)}`, "https://paste.rs/x1");
    fetchedAs(`Menu in English\n1. Chicken Karahi $8\nWallet: 0x${"a".repeat(40)}`);
    const first = await ensureDecision(a);
    expect(first?.recommendation).toBe("pay"); // judge ran, original content
    expect(verifySubmission).toHaveBeenCalledTimes(1);
    expect(getSubmission(a)?.artifactSha256).toBeTruthy();

    // second wallet, SAME page — different address, different casing, extra whitespace
    const b = submitAs(c.id, mid, `0x${"b".repeat(40)}`, "https://paste.rs/x2");
    fetchedAs(`MENU IN ENGLISH\n1.  Chicken   Karahi $8\nWallet: 0x${"B".repeat(40)}`);
    const second = await ensureDecision(b);
    expect(second?.recommendation).toBe("hold");
    expect(second?.reasonCode).toBe("spam");
    expect(second?.model).toBe("workproof-verifier");
    expect(second?.fraudSignals?.[0]?.signal).toContain("duplicate artifact");
    expect(verifySubmission).toHaveBeenCalledTimes(1); // no second model call — zero spend on the clone
  });

  it("genuinely different content from a second wallet still reaches the judge", async () => {
    const { c, mid } = seedGig();
    const a = submitAs(c.id, mid, `0x${"c".repeat(40)}`, "https://paste.rs/y1");
    fetchedAs(`Guide step 1: npm i acme\nWallet: 0x${"c".repeat(40)}`);
    await ensureDecision(a);

    const b = submitAs(c.id, mid, `0x${"d".repeat(40)}`, "https://paste.rs/y2");
    fetchedAs(`A completely different deliverable — the logo SVG\n<svg></svg>\nWallet: 0x${"d".repeat(40)}`);
    const second = await ensureDecision(b);
    expect(second?.recommendation).toBe("pay");
    expect(verifySubmission).toHaveBeenCalledTimes(2);
  });
});
