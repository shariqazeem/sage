import { describe, expect, it, vi } from "vitest";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * The observability contract: ONE correlated JSON line per pipeline step, all
 * sharing the run's correlationId, in the exact order the Deputy acts. Same heavy
 * mocks as pipeline.test.ts — but agent-log.ts is REAL here, so this captures the
 * actual trace (and prints it for the record).
 */

vi.mock("@/lib/db/campaigns", () => ({
  getSubmission: vi.fn(),
  getCampaign: vi.fn(),
  getDecisionBySubmission: vi.fn(),
  casSubmissionStatus: vi.fn(),
  recordEvent: vi.fn(),
  updateSubmission: vi.fn(),
  listPaidSubmissionsForDedup: vi.fn(() => []),
  listSubmissionsForDedup: vi.fn(() => []),
  countPaidByWalletInCampaign: vi.fn(() => 0),
  setObservationShadow: vi.fn(),
}));
vi.mock("@/lib/deputy/chain", () => ({
  getVaultState: vi.fn(),
  isVendorApproved: vi.fn(),
}));
vi.mock("@/lib/campaigns/settle-flow", () => ({ settleApprovedSubmission: vi.fn() }));
vi.mock("./decisions", () => ({ ensureDecision: vi.fn() }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn() }));

import { runDeputyOnSubmission } from "./pipeline";
import {
  casSubmissionStatus,
  getCampaign,
  getDecisionBySubmission,
  getSubmission,
} from "@/lib/db/campaigns";
import { getVaultState } from "@/lib/deputy/chain";
import { settleApprovedSubmission } from "@/lib/campaigns/settle-flow";
import { ensureDecision } from "./decisions";
import { __approveForTest } from "./model-policy";

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
  model: "google/gemini-3.1-flash-lite-preview",
  // the APPROVED policy identity so the payout clears the autopay identity gate.
  provider: "api.commonstack.ai",
  promptVersion: "payout-v1",
  parserVersion: "payout-parse-v3",
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

describe("correlated trace", () => {
  it("emits start→decision→gate→preflight→cas→settle under one correlationId", async () => {
    vi.mocked(getSubmission).mockReturnValue(submission);
    vi.mocked(getCampaign).mockReturnValue(campaign);
    vi.mocked(getDecisionBySubmission).mockReturnValue({ id: "dec_9f2" } as never);
    vi.mocked(ensureDecision).mockResolvedValue(payBrief);
    // prod approves nothing; inject the fixture's identity explicitly so the settle path runs (Gate C).
    __approveForTest({ provider: "api.commonstack.ai", model: "google/gemini-3.1-flash-lite-preview", promptVersion: "payout-v1", parserVersion: "payout-parse-v3" });
    vi.mocked(casSubmissionStatus).mockReturnValue(true);
    vi.mocked(getVaultState).mockResolvedValue({
      status: "active",
      remaining: 100,
      perTxCap: 100,
      velocityCap: 100,
    } as never);
    vi.mocked(settleApprovedSubmission).mockResolvedValue({
      outcome: {
        settled: true,
        txHash: "0xa1b68f0c9d2e",
        recipient: submission.wallet,
        amountBase: 1_000_000,
      },
    } as never);

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      if (typeof m === "string" && m.includes('"tag":"deputy"')) lines.push(m);
    });

    const result = await runDeputyOnSubmission("s1");
    spy.mockRestore();

    const parsed = lines.map((l) => JSON.parse(l) as { cid: string; step: string });
    expect(parsed.map((p) => p.step)).toEqual([
      "start",
      "decision",
      "gate",
      "preflight",
      "cas",
      "settle",
    ]);
    // every line shares the one run's correlationId
    expect(new Set(parsed.map((p) => p.cid))).toEqual(
      new Set([result.correlationId]),
    );

    // print the real trace for the record
    console.info(`\n=== CORRELATED TRACE (cid ${result.correlationId}) ===`);
    for (const l of lines) console.info(l);
    console.info("=== END TRACE ===\n");
  });
});
