import { describe, expect, it } from "vitest";
import { buildProofV2, isFoundProof, type ProofV2Inputs } from "./proof";
import type { Campaign, Mission, SettlementAttempt, Submission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

/**
 * The V2 proof is only "verified" when EVERY recomputed value agrees with the chain.
 * A stored boolean is never trusted; every mismatch class must fail to verify and a
 * rejection must never read as a payment.
 */

const VAULT = "0x1111111111111111111111111111111111111111";
const RECIP = "0x3333333333333333333333333333333333333333";
const OPERATOR = "0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35";
const CID = `0x${"a".repeat(64)}`;
const MID = `0x${"b".repeat(64)}`;
const PLAN = `0x${"c".repeat(64)}`;
const SPEC = `0x${"d".repeat(64)}`;
const DIG = `0x${"e".repeat(64)}`;
const INTENT = `0x${"f".repeat(64)}`;
const TOKEN = "0xF176f521290A937d81cc5878dfc19908f4D681A1";

const brief = {
  engine: "llm",
  model: "gemini",
  provider: "api.commonstack.ai",
  recommendation: "pay",
  reasonCode: "all_criteria_met",
  confidence: 0.97,
  summary: "genuine work",
  criteria: [{ criterion: "it works", met: true, confidence: 0.97, quote: "yes" }],
  fraudSignals: [],
  evidenceOk: true,
  contentSha256: null,
  latencyMs: 1000,
  costUsd: 0.0003,
  x402PaymentTx: null,
  x402Status: "not_configured",
  x402Reason: null,
} as unknown as DecisionBrief;

function matching(over: Partial<ProofV2Inputs> = {}): ProofV2Inputs {
  return {
    txHash: "0x" + "9".repeat(64),
    chainId: 59902,
    event: {
      settled: true,
      txHash: "0x" + "9".repeat(64),
      chainId: 59902,
      vault: VAULT,
      missionId: MID,
      recipient: RECIP,
      intentHash: INTENT,
      decisionDigest: DIG,
      amountBase: 500_000,
      failedCheckIndex: null,
      blockNumber: 100,
      explorerUrl: "x",
    },
    chain: {
      token: TOKEN,
      operator: OPERATOR,
      campaignIdHash: CID,
      missionPlanDigest: PLAN,
      factoryRecognizes: true,
      replaySupport: "supported",
      missionRewardBase: 500_000,
      budgetCeilingBase: 2_000_000,
      velocityCapBase: 1_000_000,
      budgetRemainingBase: 1_500_000,
      paidCompletions: 1,
      maxCompletions: 4,
    },
    campaign: {
      id: "founding-testers",
      chainId: 59902,
      vaultAddress: VAULT,
      campaignIdHash: CID,
      missionPlanDigest: PLAN,
      settlementToken: TOKEN,
      title: "Founding testers",
      autopilotThreshold: 0.85,
    } as unknown as Campaign,
    mission: {
      missionIdHash: MID,
      missionKey: "load",
      title: "Break signup",
      objective: "bypass",
      rewardAmount: 500_000,
      maxCompletions: 4,
      specDigest: SPEC,
    } as unknown as Mission,
    submission: { wallet: RECIP, missionSpecDigest: SPEC } as unknown as Submission,
    attempt: {
      vaultKind: "campaign_v2",
      commitmentVersion: 2,
      decisionDigest: DIG,
      payoutIntentHash: INTENT,
      missionIdHash: MID,
      status: "settled",
    } as unknown as SettlementAttempt,
    brief,
    recomputed: { decisionDigest: DIG, payoutIntentHash: INTENT },
    recomputedCampaignIdHash: CID,
    recomputedMissionIdHash: MID,
    recomputedSpecDigest: SPEC,
    network: "Metis Sepolia",
    isMainnet: false,
    ...over,
  };
}

function v2(p: ReturnType<typeof buildProofV2>) {
  if (!isFoundProof(p)) throw new Error("not found");
  return p;
}

describe("buildProofV2 — a fully-matching settlement verifies", () => {
  it("verifies and recomputes every field", () => {
    const p = v2(buildProofV2(matching()));
    expect(p.state).toBe("committed_settlement");
    expect(p.vaultKind).toBe("campaign_v2");
    expect(p.v2?.integrity.verified).toBe(true);
    expect(p.v2?.integrity.reasons).toHaveLength(0);
    expect(p.human.amountUsd).toBe(0.5);
    // the settling operator is surfaced from the vault's on-chain getOperator, never blank
    expect(p.chain.operator).toBe(OPERATOR);
    // a testnet payout is rendered as the valueless test token, never as dollars
    expect(p.human.outcome).toContain("test mUSDC");
    expect(p.human.outcome).not.toContain("$");
  });
});

describe("buildProofV2 — EVERY mismatch class is refused (never verified)", () => {
  const cases: [string, Partial<ProofV2Inputs>][] = [
    ["reward", { event: { ...matching().event!, amountBase: 999_999 } }],
    ["recipient", { event: { ...matching().event!, recipient: "0x" + "7".repeat(40) } }],
    ["mission", { recomputedMissionIdHash: `0x${"1".repeat(64)}` }],
    ["mission_plan", { chain: { ...matching().chain!, missionPlanDigest: `0x${"2".repeat(64)}` } }],
    ["mission_spec", { recomputedSpecDigest: `0x${"3".repeat(64)}` }],
    ["decision_digest", { recomputed: { decisionDigest: `0x${"4".repeat(64)}`, payoutIntentHash: INTENT } }],
    ["intent", { recomputed: { decisionDigest: DIG, payoutIntentHash: `0x${"5".repeat(64)}` } }],
    ["campaign_id", { recomputedCampaignIdHash: `0x${"6".repeat(64)}` }],
    ["token", { chain: { ...matching().chain!, token: "0x" + "8".repeat(40) } }],
    ["provenance", { chain: { ...matching().chain!, factoryRecognizes: false } }],
    ["chain_id", { event: { ...matching().event!, chainId: 2345 } }],
    ["vault", { event: { ...matching().event!, vault: "0x" + "0".repeat(40) } }],
  ];
  for (const [label, over] of cases) {
    it(`${label} mismatch → commitment_mismatch, not verified`, () => {
      const p = v2(buildProofV2(matching(over)));
      expect(p.state, label).toBe("commitment_mismatch");
      expect(p.v2?.integrity.verified, label).toBe(false);
      expect(p.v2?.integrity.reasons.length, label).toBeGreaterThan(0);
    });
  }

  it("a missing local record is incomplete, never verified", () => {
    const p = v2(buildProofV2(matching({ attempt: null })));
    expect(p.state).toBe("incomplete_local_record");
    expect(p.v2?.integrity.verified).toBe(false);
  });

  it("an uncommitted V2 attempt (no decision digest) is incomplete", () => {
    const p = v2(
      buildProofV2(
        matching({
          attempt: {
            vaultKind: "campaign_v2",
            commitmentVersion: 2,
            decisionDigest: null,
            payoutIntentHash: INTENT,
            missionIdHash: MID,
            status: "settled",
          } as unknown as SettlementAttempt,
        }),
      ),
    );
    expect(p.state).toBe("incomplete_local_record");
    expect(p.v2?.integrity.verified).toBe(false);
  });
});

describe("buildProofV2 — a rejection is never a payment", () => {
  it("PayoutRejected → verified rejection, zero paid, mission reason", () => {
    const p = v2(
      buildProofV2(
        matching({
          event: {
            ...matching().event!,
            settled: false,
            failedCheckIndex: 6,
            amountBase: 500_000,
          },
        }),
      ),
    );
    expect(p.settled).toBe(false);
    expect(p.state).toBe("committed_rejection");
    expect(p.human.amountUsd).toBe(0); // no funds moved
    expect(p.human.failedCheckReason).toContain("already been paid");
  });
});
