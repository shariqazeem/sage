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
  updateSubmission: vi.fn(),
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
  getCampaign,
  getDecisionBySubmission,
  getSubmission,
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
  criteria: [],
  fraudSignals: [],
  recommendation: "pay",
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
