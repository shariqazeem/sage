import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * FAILURE DRILLS for the autonomy pipeline. The heavy deps (DB, chain, settle,
 * brain) are mocked so the ORCHESTRATION is what's under test: does it degrade to
 * "held" (never crash) on an unreadable vault, and does a double-trigger settle
 * exactly once? The pure gate (autopilot.ts) is used for real.
 */

vi.mock("@/lib/db/campaigns", () => ({
  getSubmission: vi.fn(),
  getCampaign: vi.fn(),
  getDecisionBySubmission: vi.fn(),
  casSubmissionStatus: vi.fn(),
  recordEvent: vi.fn(),
  recordEventOnce: vi.fn(() => ({ inserted: true })),
  updateSubmission: vi.fn(),
  listPaidSubmissionsForDedup: vi.fn(() => []),
  listSubmissionsForDedup: vi.fn(() => []),
  countPaidByWalletInCampaign: vi.fn(() => 0),
  getMissionByHash: vi.fn(),
  listMissions: vi.fn(() => []),
}));
vi.mock("@/lib/deputy/chain", () => ({
  getVaultState: vi.fn(),
  isVendorApproved: vi.fn(),
}));
vi.mock("@/lib/campaigns/settle-flow", () => ({
  settleApprovedSubmission: vi.fn(),
}));
vi.mock("./decisions", () => ({ ensureDecision: vi.fn() }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn() }));
vi.mock("./agent-log", () => ({
  newCorrelationId: () => "cid_test",
  agentLog: vi.fn(),
}));

import { runDeputyOnSubmission } from "./pipeline";
import {
  casSubmissionStatus,
  countPaidByWalletInCampaign,
  getCampaign,
  getDecisionBySubmission,
  getMissionByHash,
  getSubmission,
  listSubmissionsForDedup,
  updateSubmission,
} from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { ensureDecision } from "./decisions";

const campaign = {
  id: "c1",
  title: "Ship a fix",
  rewardAmount: 1_000_000,
  vaultAddress: `0x${"1".repeat(40)}`,
  ownerIsSage: true,
  autonomy: "autopilot",
  autopilotThreshold: 0.85,
  perWalletPayoutCap: 1,
} as unknown as Campaign;

const submission = {
  id: "s1",
  campaignId: "c1",
  wallet: `0x${"a".repeat(40)}`,
  status: "pending",
} as unknown as Submission;

const payBrief: DecisionBrief = {
  engine: "llm",
  model: "deepseek/deepseek-v4-flash",
  provider: "test",
  criteria: [],
  fraudSignals: [],
  recommendation: "pay",
  reasonCode: "all_criteria_met",
  confidence: 0.95,
  summary: "",
  evidenceOk: true,
  contentSha256: null,
  latencyMs: 5,
  costUsd: 0.0003,
  x402PaymentTx: null,
};

const settledOutcome = {
  outcome: {
    settled: true,
    txHash: "0xTX",
    recipient: submission.wallet,
    amountBase: 1_000_000,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubmission).mockReturnValue(submission);
  vi.mocked(getCampaign).mockReturnValue(campaign);
  vi.mocked(getDecisionBySubmission).mockReturnValue({ id: "dec1" } as never);
  vi.mocked(ensureDecision).mockResolvedValue(payBrief);
  vi.mocked(casSubmissionStatus).mockReturnValue(true);
  // P18 Sybil pre-checks default to "clean" so each test starts from a payable state; a test that
  // exercises a hold overrides just its own signal (and clearAllMocks doesn't reset implementations).
  vi.mocked(listSubmissionsForDedup).mockReturnValue([]);
  vi.mocked(countPaidByWalletInCampaign).mockReturnValue(0);
  // P16 Step 0: default no mission row → the observation-review valve is a no-op unless a test opts in.
  vi.mocked(getMissionByHash).mockReturnValue(undefined as never);
  vi.mocked(getVaultState).mockResolvedValue({
    status: "active",
    remaining: 100,
    perTxCap: 100,
    velocityCap: 100,
  } as never);
  vi.mocked(settleApprovedSubmission).mockResolvedValue(settledOutcome as never);
});

describe("runDeputyOnSubmission — happy path", () => {
  it("settles a clean autopilot submission exactly once", async () => {
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("settled");
    expect(r.txHash).toBe("0xTX");
    expect(r.correlationId).toBe("cid_test");
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
  });
});

describe("P16 Step 0 — observation-based missions are NEVER auto-paid (safety valve)", () => {
  it("HOLDS an observation-based mission with reason observation_review, before any settle", async () => {
    vi.mocked(getSubmission).mockReturnValue({ ...submission, missionIdHash: "0xMISSION" } as never);
    vi.mocked(getMissionByHash).mockReturnValue({ missionKey: "m1", verifiabilityClass: "observation-based" } as never);
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("held");
    expect(r.reason).toBe("observation_review");
    expect(casSubmissionStatus).not.toHaveBeenCalled();
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
  });

  it("a url-verifiable mission settles exactly as before (byte-identical path)", async () => {
    vi.mocked(getSubmission).mockReturnValue({ ...submission, missionIdHash: "0xMISSION" } as never);
    vi.mocked(getMissionByHash).mockReturnValue({ missionKey: "m1", verifiabilityClass: "url-verifiable" } as never);
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("settled");
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
  });
});

describe("P18: Sybil holds — never auto-pay a duplicate or a capped wallet", () => {
  const FARM_NOTE =
    "I completed the signup flow at the pricing page and confirmed the three plan tiers are visible and the get started button works.";

  it("HOLDS a near-duplicate (paraphrased) report before any settle", async () => {
    vi.mocked(getSubmission).mockReturnValue({ ...submission, note: FARM_NOTE } as never);
    vi.mocked(listSubmissionsForDedup).mockReturnValue([
      { note: FARM_NOTE.replace("signup", "sign up").replace("get started", "Get Started"), contentSha256: null },
    ]);
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/duplicate account/i);
    expect(casSubmissionStatus).not.toHaveBeenCalled();
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
  });

  it("HOLDS once the wallet has reached its per-campaign payout cap", async () => {
    vi.mocked(countPaidByWalletInCampaign).mockReturnValue(1); // cap is 1
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/per-campaign payout cap/i);
    expect(casSubmissionStatus).not.toHaveBeenCalled();
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
  });
});

describe("DRILL: RPC read failure in preflight", () => {
  it("HOLDS (never crashes) and never claims/settles when the vault is unreadable", async () => {
    vi.mocked(getVaultState).mockRejectedValue(new Error("RPC timeout"));
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/unreadable/i);
    // held BEFORE the CAS — the item stays pending for the next sweep to retry
    expect(casSubmissionStatus).not.toHaveBeenCalled();
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
  });
});

describe("DRILL: double-trigger race", () => {
  it("two concurrent triggers settle EXACTLY once (CAS lets one win)", async () => {
    let claimed = false;
    vi.mocked(casSubmissionStatus).mockImplementation((_id, from, to) => {
      if (from === "pending" && to === "settling" && !claimed) {
        claimed = true;
        return true;
      }
      return false;
    });

    const [a, b] = await Promise.all([
      runDeputyOnSubmission("s1"),
      runDeputyOnSubmission("s1"),
    ]);

    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
    expect([a.action, b.action].sort()).toEqual(["settled", "skipped"]);
  });
});

describe("DRILL: settle throws", () => {
  it("HOLDS and resets to pending (never retry-loops a failed spend)", async () => {
    vi.mocked(settleApprovedSubmission).mockRejectedValue(new Error("chain revert"));
    const r = await runDeputyOnSubmission("s1");
    expect(r.action).toBe("held");
    expect(r.reason).toBe("settlement error");
    expect(updateSubmission).toHaveBeenCalledWith("s1", {
      status: "pending",
      decidedAt: null,
    });
  });
});
