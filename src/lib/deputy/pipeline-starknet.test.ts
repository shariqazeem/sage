import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, Submission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * A STARKNET SUBMISSION MUST REACH SETTLEMENT.
 *
 * The drill this file exists for: before the fix, every Starknet submission entered the EVM
 * pre-flight, whose first statement is `getAddress(campaign.vaultAddress)`. A Starknet address is
 * a felt, viem rejects it, and it throws SYNCHRONOUSLY — ahead of every try/catch below it. The
 * submission reset to pending, the next sweep retried it, and the rail's own settlement branch
 * sits FURTHER DOWN the pipeline than the pre-flight, so it was never reached. Nobody was paid,
 * forever, and each retry spent another judgement.
 *
 * Testing the Starknet pre-flight on its own could not catch that: the defect was the routing.
 * This runs the whole pipeline.
 */

vi.mock("@/lib/db/campaigns", () => ({
  getSubmission: vi.fn(),
  getCampaign: vi.fn(),
  getDecisionBySubmission: vi.fn(),
  casSubmissionStatus: vi.fn(() => true),
  recordEvent: vi.fn(),
  getLatestSubmissionEvent: vi.fn(() => undefined),
  recordEventOnce: vi.fn(() => ({ inserted: true })),
  updateSubmission: vi.fn(),
  listPaidSubmissionsForDedup: vi.fn(() => []),
  listSubmissionsForDedup: vi.fn(() => []),
  listEarlierSubmissionsForDedup: vi.fn(() => []),
  countPaidByWalletInCampaign: vi.fn(() => 0),
  countPaidForMission: vi.fn(() => 0),
  setObservationShadow: vi.fn(),
  getMissionByHash: vi.fn(() => undefined),
  listMissions: vi.fn(() => []),
}));
vi.mock("./observation-judge", () => ({
  runObservationDecision: vi.fn(async () => ({
    bar: { pass: false, reasons: [] },
    publicView: { distinctSources: 0, matchedCount: 0, keyDistinctSources: 0, corpusDigest: "0x0", barPass: false, barReasons: [] },
    corpusMatch: { distinctSources: 0, matchedCount: 0, matched: [] },
    injectionDetected: false, nearDupSimilarity: 0, obsConfidence: 0, contradictions: [],
  })),
  observationAutopayEnabled: vi.fn(() => false),
  toObservationShadow: vi.fn(() => ({})),
}));
vi.mock("@/lib/deputy/chain", () => ({ getVaultState: vi.fn(), isVendorApproved: vi.fn() }));
vi.mock("@/lib/deputy/chain-freshness", async (orig) => ({
  ...(await orig<typeof import("@/lib/deputy/chain-freshness")>()),
  readChainFreshness: vi.fn(async () => ({ fresh: true, blockNumber: 1, headAgeSeconds: 2, reason: "current" as const })),
}));
vi.mock("@/lib/campaigns/settle-flow", () => ({ settleApprovedSubmission: vi.fn() }));
vi.mock("@/lib/campaigns/settle-starknet", () => ({ settleOnStarknet: vi.fn() }));
vi.mock("@/lib/starknet/vault", () => ({ readVaultState: vi.fn(), readVaultBalance: vi.fn() }));
vi.mock("./decisions", () => ({ ensureDecision: vi.fn() }));
vi.mock("./canary-preflight", () => ({ payoutReplaySchemaReady: vi.fn(() => ({ ok: true, missing: [] })) }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn() }));
vi.mock("@/lib/telegram/founder-notify", () => ({ notifyFounderHeld: vi.fn(), notifyRecipientPaid: vi.fn() }));
vi.mock("@/lib/campaigns/announce", () => ({
  announceCampaignSettled: vi.fn(),
  announceCampaignSettledStarknet: vi.fn(),
}));
vi.mock("./agent-log", () => ({ newCorrelationId: () => "cid_sn", agentLog: vi.fn() }));
// `getEnv()` memoises, so setting process.env inside a test is a no-op after the first read —
// the flag is mocked instead, or the real-money drill below would silently pass while proving
// nothing. (Found by this very test appearing to fail against a fix that was in fact correct.)
vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  mainnetAutopilotEnabled: vi.fn(() => true),
}));
vi.mock("./entailment", () => ({
  entailmentMode: vi.fn(() => "off"),
  entailmentInputFromBrief: vi.fn(() => ({ criteria: [], note: null })),
  runEntailmentVeto: vi.fn(async () => ({ ran: true, vetoed: false, verdicts: [], vetoReason: "", model: "m", provider: "p", promptVersion: "v", parserVersion: "v", latencyMs: 1, inputDigest: "d", resultDigest: "d", error: null })),
}));

import { runDeputyOnSubmission } from "./pipeline";
import { getCampaign, getDecisionBySubmission, getSubmission } from "@/lib/db/campaigns";
import { settleOnStarknet } from "@/lib/campaigns/settle-starknet";
import { readVaultBalance, readVaultState } from "@/lib/starknet/vault";
import { ensureDecision } from "./decisions";
import { __approveForTest, __clearTestApprovals } from "./model-policy";
import { mainnetAutopilotEnabled } from "@/lib/env";

const VAULT_FELT = "0x69c2d2cab84b227c01e07d75f6a065270e610ae490067b8b06f4c07a8af040d";
const RECIPIENT = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

const campaign = {
  id: "c-sn",
  title: "Private-capable campaign",
  rewardAmount: 500_000,
  vaultAddress: VAULT_FELT,
  vaultKind: "sage_vault_starknet",
  settlementRail: "starknet",
  chainId: 900_001,
  ownerIsSage: false,
  autonomy: "autopilot",
  autopilotThreshold: 0.85,
  perWalletPayoutCap: 1,
} as unknown as Campaign;

const submission = {
  id: "s-sn",
  campaignId: "c-sn",
  wallet: RECIPIENT,
  status: "pending",
} as unknown as Submission;

const payBrief: DecisionBrief = {
  engine: "llm",
  model: "google/gemini-3.1-flash-lite-preview",
  provider: "api.commonstack.ai",
  promptVersion: "payout-v1",
  parserVersion: "payout-parse-v3",
  criteria: [], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met",
  confidence: 0.95, summary: "", evidenceOk: true, contentSha256: null,
  latencyMs: 5, costUsd: 0.0003, x402PaymentTx: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  __clearTestApprovals();
  __approveForTest({ provider: "api.commonstack.ai", model: "google/gemini-3.1-flash-lite-preview", promptVersion: "payout-v1", parserVersion: "payout-parse-v3" });
  vi.mocked(getSubmission).mockReturnValue(submission);
  vi.mocked(getCampaign).mockReturnValue(campaign);
  vi.mocked(getDecisionBySubmission).mockReturnValue({ id: "dec1" } as never);
  vi.mocked(ensureDecision).mockResolvedValue(payBrief);
  vi.mocked(readVaultState).mockResolvedValue({
    statusLabel: "active",
    budgetCeilingBase: BigInt(2_000_000),
    totalSpentBase: BigInt(0),
  } as never);
  vi.mocked(readVaultBalance).mockResolvedValue(BigInt(2_000_000));
  vi.mocked(settleOnStarknet).mockResolvedValue({
    settled: true,
    txHash: "0xSNTX",
    recipient: RECIPIENT,
    rewardBase: BigInt(500_000),
    explorerUrl: "https://voyager.online/tx/0xSNTX",
  } as never);
  vi.mocked(mainnetAutopilotEnabled).mockReturnValue(true);
});

describe("a private-capable campaign settles autonomously", () => {
  it("reaches Starknet settlement instead of dying in the EVM pre-flight", async () => {
    const r = await runDeputyOnSubmission("s-sn");
    expect(r.action).toBe("settled");
    expect(r.txHash).toBe("0xSNTX");
    expect(settleOnStarknet).toHaveBeenCalledTimes(1);
  });

  it("reads the Cairo vault, and never hands a felt to the EVM vault reader", async () => {
    await runDeputyOnSubmission("s-sn");
    expect(readVaultState).toHaveBeenCalledWith(VAULT_FELT);
    const { getVaultState } = await import("@/lib/deputy/chain");
    expect(getVaultState).not.toHaveBeenCalled();
  });

  it("holds — rather than paying — when the vault is not funded", async () => {
    vi.mocked(readVaultBalance).mockResolvedValue(BigInt(0));
    const r = await runDeputyOnSubmission("s-sn");
    expect(r.action).toBe("held");
    expect(settleOnStarknet).not.toHaveBeenCalled();
  });

  it("holds when the vault is paused, without attempting a payout", async () => {
    vi.mocked(readVaultState).mockResolvedValue({
      statusLabel: "paused",
      budgetCeilingBase: BigInt(2_000_000),
      totalSpentBase: BigInt(0),
    } as never);
    const r = await runDeputyOnSubmission("s-sn");
    expect(r.action).toBe("held");
    expect(settleOnStarknet).not.toHaveBeenCalled();
  });

  it("HOLDS REAL MONEY when mainnet autopilot is off", async () => {
    // Starknet is real USDC. Before the gate asked the registry, this rail auto-paid with the
    // switch off — the documented invariant was simply false here.
    vi.mocked(mainnetAutopilotEnabled).mockReturnValue(false);
    const r = await runDeputyOnSubmission("s-sn");
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/mainnet autopilot is off/i);
    expect(settleOnStarknet).not.toHaveBeenCalled();
  });
});
