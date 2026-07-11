import { describe, expect, it } from "vitest";

import { buildProof, isFoundProof, type ProofInputs } from "./proof";
import type { PayoutProof } from "./chain";
import type { Campaign, SettlementAttempt } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

const ONCHAIN = `0x${"a".repeat(64)}`;
const DIGEST = `0x${"d".repeat(64)}`;
const TX = `0x${"e".repeat(64)}`;

function payoutProof(over: Partial<PayoutProof> = {}): PayoutProof {
  return {
    txHash: TX,
    settled: true,
    recipient: `0x${"b".repeat(40)}`,
    amount: 0.5,
    intentHash: ONCHAIN,
    timestamp: 1000,
    blockNumber: 100,
    failedCheckIndex: null,
    vault: `0x${"1".repeat(40)}`,
    operator: `0x${"2".repeat(40)}`,
    perTxCap: 25,
    budget: 500,
    remaining: 400,
    velocityCap: 100,
    chainId: 59902,
    network: "Metis Sepolia",
    explorerUrl: `https://x/tx/${TX}`,
    ...over,
  } as PayoutProof;
}

function attempt(over: Partial<SettlementAttempt> = {}): SettlementAttempt {
  return {
    id: "a1",
    payoutIntentHash: ONCHAIN,
    decisionDigest: DIGEST,
    submissionId: "s1",
    campaignId: "c1",
    chainId: 59902,
    vaultAddress: `0x${"1".repeat(40)}`,
    recipient: `0x${"b".repeat(40)}`,
    amountBase: 500_000,
    status: "settled",
    txHash: TX,
    failedCheckIndex: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as SettlementAttempt;
}

function brief(over: Partial<DecisionBrief> = {}): DecisionBrief {
  return {
    criteria: [{ criterion: "loads", met: true, confidence: 0.95, quote: "it loads" }],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.95,
    summary: "genuine work",
    engine: "llm",
    model: "gemini",
    provider: "api.commonstack.ai",
    evidenceOk: true,
    contentSha256: "a".repeat(64),
    latencyMs: 1000,
    costUsd: 0.0003,
    x402PaymentTx: null,
    ...over,
  } as DecisionBrief;
}

function inputs(over: Partial<ProofInputs> = {}): ProofInputs {
  return {
    txHash: TX,
    chainId: 59902,
    proof: payoutProof(),
    campaign: { title: "Founding testers" } as Campaign,
    decision: null,
    submission: null,
    attempt: attempt(),
    recomputed: { payoutIntentHash: ONCHAIN, decisionDigest: DIGEST },
    brief: brief(),
    capability: "supported",
    ...over,
  };
}

describe("buildProof — committed states (all three intent sources agree)", () => {
  it("a settled, decision-committed payout → committed_settlement, verified", () => {
    const p = buildProof(inputs());
    expect(p.state).toBe("committed_settlement");
    if (!isFoundProof(p)) throw new Error("expected found");
    expect(p.legacy).toBe(false);
    expect(p.commitment?.matches).toBe(true);
    expect(p.decision).not.toBeNull();
    expect(p.chain.onchainIntent).toBe(ONCHAIN);
  });

  it("a blocked, decision-committed payout → committed_rejection", () => {
    const p = buildProof(
      inputs({
        proof: payoutProof({ settled: false, failedCheckIndex: 5 }),
        attempt: attempt({ status: "rejected", failedCheckIndex: 5 }),
      }),
    );
    expect(p.state).toBe("committed_rejection");
    if (!isFoundProof(p)) throw new Error("expected found");
    expect(p.settled).toBe(false);
    expect(p.human.failedCheckReason).toContain("budget");
  });
});

describe("buildProof — legacy states (no decision commitment on record)", () => {
  it("no attempt row → legacy_settlement, honestly not decision-committed", () => {
    const p = buildProof(inputs({ attempt: null }));
    expect(p.state).toBe("legacy_settlement");
    if (!isFoundProof(p)) throw new Error("expected found");
    expect(p.legacy).toBe(true);
    expect(p.commitment).toBeNull();
  });

  it("an attempt without a decision digest → legacy (not committed)", () => {
    const p = buildProof(inputs({ attempt: attempt({ decisionDigest: null }) }));
    expect(p.state).toBe("legacy_settlement");
  });

  it("a blocked legacy payout → legacy_rejection", () => {
    const p = buildProof(
      inputs({ attempt: null, proof: payoutProof({ settled: false, failedCheckIndex: 3 }) }),
    );
    expect(p.state).toBe("legacy_rejection");
  });
});

describe("buildProof — a mismatch can NEVER render as verified", () => {
  it("recomputed intent ≠ on-chain → commitment_mismatch, matches=false", () => {
    const p = buildProof(
      inputs({ recomputed: { payoutIntentHash: `0x${"9".repeat(64)}`, decisionDigest: DIGEST } }),
    );
    expect(p.state).toBe("commitment_mismatch");
    if (!isFoundProof(p)) throw new Error("expected found");
    expect(p.commitment?.matches).toBe(false);
    expect(p.commitment?.mismatchReason).toBe("recomputed_intent_ne_onchain");
    expect(p.state).not.toBe("committed_settlement");
  });

  it("stored intent ≠ on-chain → commitment_mismatch (stored_intent_ne_onchain)", () => {
    const p = buildProof(inputs({ attempt: attempt({ payoutIntentHash: `0x${"7".repeat(64)}` }) }));
    expect(p.state).toBe("commitment_mismatch");
    if (!isFoundProof(p)) throw new Error("expected found");
    expect(p.commitment?.mismatchReason).toBe("stored_intent_ne_onchain");
  });
});

describe("buildProof — incomplete + not_found", () => {
  it("a committed attempt whose brief is missing → incomplete_local_record (not a mismatch)", () => {
    const p = buildProof(inputs({ brief: null, recomputed: null }));
    expect(p.state).toBe("incomplete_local_record");
    if (!isFoundProof(p)) throw new Error("expected found");
    expect(p.commitment?.matches).toBe(false);
    expect(p.commitment?.mismatchReason).toBe("cannot_recompute_missing_brief");
    expect(p.decision).toBeNull();
    expect(p.decisionUnavailableReason).toBeTruthy();
  });

  it("no on-chain proof → not_found", () => {
    const p = buildProof(inputs({ proof: null }));
    expect(p.state).toBe("not_found");
    expect(isFoundProof(p)).toBe(false);
  });
});
