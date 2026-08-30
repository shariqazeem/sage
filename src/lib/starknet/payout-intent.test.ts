import { describe, expect, it } from "vitest";
import { starknetPayoutIntent, type StarknetDecisionFacts } from "./payout-intent";
import type { Campaign, Submission } from "@/lib/db/schema";

/**
 * WHY THIS RAIL HAS ITS OWN COMMITMENTS.
 *
 * The EVM commitment encodes vault and recipient as ABI `address` — twenty bytes. A Starknet
 * address is a felt, thirty-two, so it does not merely fail a checksum: it cannot be that type at
 * all, and viem's getAddress threw on it before the encoder was ever reached.
 *
 * It only runs when a DECISION EXISTS, which is why no dry run and no test caught it — none had
 * judged work. It fired the first time a founder released a held submission, as
 * "On-chain settlement failed. The submission is approved; retry to settle."
 */

const campaign = { id: "launch-starkscan-co-qsnl31" } as unknown as Campaign;
const submission = { id: "ciZjWLS_Lbji" } as unknown as Submission;
/** The felt that broke it — 64 hex characters, not an EVM address. */
const FELT_VAULT = "0xa532813beec157be5da0a74f934c3534458f77fa4c148ae15bf5ce0bf8ec5b";

const decision = (over: Partial<StarknetDecisionFacts> = {}): StarknetDecisionFacts => ({
  id: "d1",
  contentSha256: "38e7d00f77af9d87",
  recommendation: "hold",
  reasonCode: "no_evidence",
  confidence: 0.15,
  model: "MiniMax-M3",
  ...over,
});

describe("commitments a Cairo vault can actually store", () => {
  it("derives both without ever touching an EVM address", () => {
    // The felt is present in the campaign that produced this; nothing here parses it as an address.
    const out = starknetPayoutIntent({ ...campaign, vaultAddress: FELT_VAULT } as never, submission, decision());
    expect(out.payoutIntentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(out.decisionDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("both are non-zero — the vault refuses MISSING_DIGESTS otherwise", () => {
    const out = starknetPayoutIntent(campaign, submission, decision());
    expect(BigInt(out.payoutIntentHash)).toBeGreaterThan(BigInt(0));
    expect(BigInt(out.decisionDigest!)).toBeGreaterThan(BigInt(0));
  });

  it("the intent is STABLE for a submission, so a retry is the same authorisation", () => {
    // If it moved, the vault's replay protection would treat a sweep re-fire as a second payout.
    const a = starknetPayoutIntent(campaign, submission, decision());
    const b = starknetPayoutIntent(campaign, submission, decision());
    expect(a.payoutIntentHash).toBe(b.payoutIntentHash);
  });

  it("the intent does NOT move when the submission is re-judged", () => {
    // A held submission can be judged again before release. A new intent there would be read as a
    // fresh authorisation, and replay protection would stop protecting anything.
    const first = starknetPayoutIntent(campaign, submission, decision({ id: "d1", confidence: 0.15 }));
    const rejudged = starknetPayoutIntent(campaign, submission, decision({ id: "d2", confidence: 0.91 }));
    expect(rejudged.payoutIntentHash).toBe(first.payoutIntentHash);
    // ...but the DECISION digest does, because it commits to which decision authorised the payout.
    expect(rejudged.decisionDigest).not.toBe(first.decisionDigest);
  });

  it("different submissions never share an intent", () => {
    const a = starknetPayoutIntent(campaign, submission, decision());
    const b = starknetPayoutIntent(campaign, { ...submission, id: "other" } as never, decision());
    expect(a.payoutIntentHash).not.toBe(b.payoutIntentHash);
  });

  it("different campaigns never share an intent either", () => {
    const a = starknetPayoutIntent(campaign, submission, decision());
    const b = starknetPayoutIntent({ ...campaign, id: "other-campaign" } as never, submission, decision());
    expect(a.payoutIntentHash).not.toBe(b.payoutIntentHash);
  });

  it("an unjudged payout still has an intent, and no decision digest", () => {
    const out = starknetPayoutIntent(campaign, submission, null);
    expect(out.payoutIntentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(out.decisionDigest).toBeNull();
  });

  it("the decision digest moves with every field it commits to", () => {
    const base = starknetPayoutIntent(campaign, submission, decision()).decisionDigest;
    for (const over of [
      { contentSha256: "different" },
      { recommendation: "pay" },
      { reasonCode: "verified" },
      { confidence: 0.16 },
      { model: "other-model" },
    ] as Partial<StarknetDecisionFacts>[]) {
      expect(starknetPayoutIntent(campaign, submission, decision(over)).decisionDigest, JSON.stringify(over)).not.toBe(base);
    }
  });

  it("rounds confidence before hashing — a digest must not move with floating-point noise", () => {
    const a = starknetPayoutIntent(campaign, submission, decision({ confidence: 0.15 })).decisionDigest;
    const b = starknetPayoutIntent(campaign, submission, decision({ confidence: 0.15 + 1e-12 })).decisionDigest;
    expect(a).toBe(b);
  });
});
