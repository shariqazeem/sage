import { describe, expect, it, vi } from "vitest";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { StoredBrief } from "@/lib/deputy/brain-core";
import { RateLimiter } from "@/lib/rate-limit";

/**
 * The public "try to jailbreak the Deputy" box runs the real pipeline against a
 * sandbox campaign. These prove the isolation is STRUCTURAL, not merely gated:
 * settle throws, reputation excludes it, and the attempt budget is capped.
 */

// Mock the signer so we can prove the sandbox guard fires BEFORE any chain call.
vi.mock("@/lib/deputy/signer", () => ({
  ensureVendorApproved: vi.fn(),
  submitRequestSpend: vi.fn(),
}));

import { settleSubmission } from "@/lib/campaigns/settle";
import { ensureVendorApproved, submitRequestSpend } from "@/lib/deputy/signer";
import {
  createCampaign,
  createSubmission,
  insertDecision,
  listAllDecisions,
  listRecentDecisions,
} from "@/lib/db/campaigns";

const submission = {
  id: "s1",
  wallet: `0x${"a".repeat(40)}`,
} as unknown as Submission;

const sandboxCampaign = {
  id: "redteam-sandbox",
  chainId: 59902,
  vaultAddress: `0x${"0".repeat(40)}`,
  rewardAmount: 500_000,
  sandbox: true,
} as unknown as Campaign;

const storedBrief = (): StoredBrief => ({
  criteria: [],
  fraudSignals: [],
  recommendation: "pay",
  reasonCode: "all_criteria_met",
  confidence: 0.9,
  summary: "",
  provider: null,
});

describe("hard sandbox isolation — payment is structurally unreachable", () => {
  it("settleSubmission THROWS for a sandbox campaign, before any chain call", async () => {
    await expect(
      settleSubmission({ campaign: sandboxCampaign, submission }),
    ).rejects.toThrow(/sandbox/i);
    // the guard fires first — the signer is never touched
    expect(ensureVendorApproved).not.toHaveBeenCalled();
    expect(submitRequestSpend).not.toHaveBeenCalled();
  });
});

describe("sandbox decisions are excluded from reputation (DB-backed)", () => {
  it("listAllDecisions + listRecentDecisions skip sandbox-campaign decisions", () => {
    const real = createCampaign({
      title: "Real campaign",
      rewardAmount: 1_000_000,
      vaultAddress: `0x${"1".repeat(40)}`,
      posterWallet: `0x${"2".repeat(40)}`,
    });
    const sandbox = createCampaign({
      title: "Sandbox jailbreak",
      rewardAmount: 500_000,
      vaultAddress: `0x${"0".repeat(40)}`,
      posterWallet: `0x${"0".repeat(40)}`,
      sandbox: true,
    });
    const rSub = createSubmission({ campaignId: real.id, wallet: `0x${"a".repeat(40)}` });
    const sSub = createSubmission({ campaignId: sandbox.id, wallet: `0x${"b".repeat(40)}` });
    expect(rSub.ok && sSub.ok).toBe(true);
    if (!rSub.ok || !sSub.ok) return;

    const common = {
      engine: "llm",
      model: "m",
      brief: storedBrief(),
      contentSha256: null,
      evidenceOk: true,
      latencyMs: 1,
      costUsd: 0,
      x402PaymentTx: null,
    };
    insertDecision({ submissionId: rSub.submission.id, campaignId: real.id, ...common });
    insertDecision({ submissionId: sSub.submission.id, campaignId: sandbox.id, ...common });

    const all = listAllDecisions();
    expect(all.some((d) => d.campaignId === real.id)).toBe(true);
    expect(all.some((d) => d.campaignId === sandbox.id)).toBe(false); // excluded

    const recent = listRecentDecisions(50);
    expect(recent.some((d) => d.campaignTitle === "Real campaign")).toBe(true);
    expect(recent.some((d) => d.campaignTitle === "Sandbox jailbreak")).toBe(false);
  });
});

describe("red-team rate limiting", () => {
  it("the daily cap blocks the (N+1)th attempt and resets after 24h", () => {
    let t = 0;
    const daily = new RateLimiter(2, 86_400_000, () => t);
    expect(daily.hit("global").ok).toBe(true);
    expect(daily.hit("global").ok).toBe(true);
    expect(daily.hit("global").ok).toBe(false); // over the daily budget → honest "budget reached"
    t += 86_400_001;
    expect(daily.hit("global").ok).toBe(true); // fresh day
  });

  it("the per-IP limiter caps attempts within its window", () => {
    const perIp = new RateLimiter(6, 60_000, () => 0);
    for (let i = 0; i < 6; i++) expect(perIp.hit("ip").ok).toBe(true);
    expect(perIp.hit("ip").ok).toBe(false); // 7th within the minute
  });
});
