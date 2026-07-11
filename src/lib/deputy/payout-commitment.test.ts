import { describe, expect, it } from "vitest";

import type {
  BriefCriterion,
  BriefFraudSignal,
} from "./brain-core";
import {
  computeDecisionCommitment,
  evidenceToBytes32,
  payoutIntentFromDigest,
  toBasisPoints,
  type DecisionCommitmentInput,
} from "./payout-commitment";

const SHA_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** A fixed, valid decision — the base every sensitivity test perturbs. */
function base(): DecisionCommitmentInput {
  return {
    chainId: 59902,
    vault: "0x987b93bf3b5E245211eB7Cb164C03cdfCC9c0850",
    campaignId: "founding-testers",
    submissionId: "sub_01HXYZ",
    decisionId: "dec_01HXYZ",
    recipient: "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3",
    amountBase: BigInt(500_000),
    evidenceSha256: SHA_A,
    criteria: [
      {
        criterion: "The app deploys and loads",
        met: true,
        confidence: 0.95,
        quote: "the deployment succeeded and the app is live",
      },
      {
        criterion: "A working feature is demonstrated",
        met: true,
        confidence: 0.9,
        quote: "clicking submit records the entry",
      },
    ],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.95,
    model: "gemini-3.1-flash-lite-preview",
    provider: "api.commonstack.ai",
  };
}

const digestOf = (i: DecisionCommitmentInput) =>
  computeDecisionCommitment(i).decisionDigest;

describe("computeDecisionCommitment — shape & determinism", () => {
  it("returns two distinct 32-byte hashes", () => {
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitment(
      base(),
    );
    expect(decisionDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payoutIntentHash).toMatch(/^0x[0-9a-f]{64}$/);
    // domain separation: the on-chain intent is derived from, not equal to, the digest.
    expect(payoutIntentHash).not.toEqual(decisionDigest);
  });

  it("is deterministic — identical input yields identical hashes", () => {
    const a = computeDecisionCommitment(base());
    const b = computeDecisionCommitment(base());
    expect(a.decisionDigest).toEqual(b.decisionDigest);
    expect(a.payoutIntentHash).toEqual(b.payoutIntentHash);
  });

  it("payoutIntentHash is a pure function of the digest", () => {
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitment(
      base(),
    );
    expect(payoutIntentFromDigest(decisionDigest)).toEqual(payoutIntentHash);
  });

  it("pins the canonical encoding (golden) — changing it must be deliberate", () => {
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitment(
      base(),
    );
    expect(decisionDigest).toMatchInlineSnapshot(`"0x1645e0b222f0420111c74f99373041af29d26e0ae7eeeb9a839ce46ca92754b4"`);
    expect(payoutIntentHash).toMatchInlineSnapshot(`"0x8503077aee35242318aaa32d1f2a29cd902f330bff40af3d2f787619095b9304"`);
  });
});

describe("computeDecisionCommitment — every committed field is load-bearing", () => {
  const b = base();
  const d0 = digestOf(b);

  it("chainId flips the digest", () => {
    expect(digestOf({ ...b, chainId: 2345 })).not.toEqual(d0);
  });

  it("vault flips the digest", () => {
    expect(
      digestOf({ ...b, vault: "0x991047490eE07178dcf270221e4BFa47793C8915" }),
    ).not.toEqual(d0);
  });

  it("recipient flips the digest", () => {
    expect(
      digestOf({ ...b, recipient: "0x0000000000000000000000000000000000000001" }),
    ).not.toEqual(d0);
  });

  it("amount flips the digest", () => {
    expect(digestOf({ ...b, amountBase: BigInt(500_001) })).not.toEqual(d0);
  });

  it("campaign / submission / decision ids each flip the digest", () => {
    expect(digestOf({ ...b, campaignId: "other" })).not.toEqual(d0);
    expect(digestOf({ ...b, submissionId: "other" })).not.toEqual(d0);
    expect(digestOf({ ...b, decisionId: "other" })).not.toEqual(d0);
  });

  it("evidence hash flips the digest; absent evidence differs from present", () => {
    expect(digestOf({ ...b, evidenceSha256: SHA_B })).not.toEqual(d0);
    expect(digestOf({ ...b, evidenceSha256: null })).not.toEqual(d0);
  });

  it("recommendation and reasonCode each flip the digest", () => {
    expect(digestOf({ ...b, recommendation: "hold" })).not.toEqual(d0);
    expect(digestOf({ ...b, reasonCode: "prompt_injection" })).not.toEqual(d0);
  });

  it("confidence flips the digest at basis-point resolution", () => {
    expect(digestOf({ ...b, confidence: 0.96 })).not.toEqual(d0);
  });

  it("model and provider each flip the digest", () => {
    expect(digestOf({ ...b, model: "deepseek-v4-flash" })).not.toEqual(d0);
    expect(digestOf({ ...b, provider: "openrouter.ai" })).not.toEqual(d0);
  });
});

describe("computeDecisionCommitment — the criteria & signals are committed in order", () => {
  const b = base();
  const d0 = digestOf(b);

  it("flipping a criterion's met result flips the digest", () => {
    const criteria = b.criteria.map((c, i) =>
      i === 0 ? { ...c, met: false } : c,
    );
    expect(digestOf({ ...b, criteria })).not.toEqual(d0);
  });

  it("changing a criterion's confidence flips the digest", () => {
    const criteria = b.criteria.map((c, i) =>
      i === 0 ? { ...c, confidence: 0.5 } : c,
    );
    expect(digestOf({ ...b, criteria })).not.toEqual(d0);
  });

  it("changing a verbatim quote flips the digest", () => {
    const criteria = b.criteria.map((c, i) =>
      i === 0 ? { ...c, quote: "a different span" } : c,
    );
    expect(digestOf({ ...b, criteria })).not.toEqual(d0);
  });

  it("dropping a quote flips the digest (accepted-quote set changes)", () => {
    const criteria = b.criteria.map((c, i) =>
      i === 0 ? { criterion: c.criterion, met: c.met, confidence: c.confidence } : c,
    );
    expect(digestOf({ ...b, criteria })).not.toEqual(d0);
  });

  it("reordering criteria flips the digest — order is part of the commitment", () => {
    const swapped: BriefCriterion[] = [b.criteria[1], b.criteria[0]];
    expect(digestOf({ ...b, criteria: swapped })).not.toEqual(d0);
  });

  it("adding a fraud signal flips the digest", () => {
    const fraudSignals: BriefFraudSignal[] = [
      { signal: "prompt injection", severity: "high", reason: "note gave orders" },
    ];
    expect(digestOf({ ...b, fraudSignals })).not.toEqual(d0);
  });

  it("reordering fraud signals flips the digest", () => {
    const s1: BriefFraudSignal = { signal: "a", severity: "low", reason: "x" };
    const s2: BriefFraudSignal = { signal: "b", severity: "high", reason: "y" };
    expect(digestOf({ ...b, fraudSignals: [s1, s2] })).not.toEqual(
      digestOf({ ...b, fraudSignals: [s2, s1] }),
    );
  });
});

describe("computeDecisionCommitment — quantization & normalization boundaries", () => {
  const b = base();

  it("a sub-basis-point confidence wobble does NOT change the digest", () => {
    // 0.95 and 0.9500004 both round to 9500 bps — the same committed value.
    expect(digestOf({ ...b, confidence: 0.950_000_4 })).toEqual(digestOf(b));
  });

  it("evidence hash is normalized: 0x-prefixed and bare hex commit identically", () => {
    expect(digestOf({ ...b, evidenceSha256: `0x${SHA_A}` })).toEqual(
      digestOf({ ...b, evidenceSha256: SHA_A }),
    );
  });

  it("a malformed evidence hash commits as absent (zero), not as garbage", () => {
    expect(digestOf({ ...b, evidenceSha256: "not-a-hash" })).toEqual(
      digestOf({ ...b, evidenceSha256: null }),
    );
  });

  it("null and empty-string model both mean 'no model'", () => {
    expect(digestOf({ ...b, model: "" })).toEqual(
      digestOf({ ...b, model: null }),
    );
  });
});

describe("computeDecisionCommitment — refuses to commit to garbage", () => {
  it("throws on a malformed vault address", () => {
    expect(() =>
      computeDecisionCommitment({ ...base(), vault: "0xNOPE" }),
    ).toThrow();
  });

  it("throws on a malformed recipient address", () => {
    expect(() =>
      computeDecisionCommitment({ ...base(), recipient: "not-an-address" }),
    ).toThrow();
  });
});

describe("toBasisPoints", () => {
  it("rounds to the nearest basis point", () => {
    expect(toBasisPoints(0.95)).toBe(9500);
    expect(toBasisPoints(0.949_94)).toBe(9499);
    expect(toBasisPoints(0.949_96)).toBe(9500);
  });

  it("clamps to [0, 10000] and treats non-finite as 0", () => {
    expect(toBasisPoints(1)).toBe(10_000);
    expect(toBasisPoints(1.5)).toBe(10_000);
    expect(toBasisPoints(-0.1)).toBe(0);
    expect(toBasisPoints(Number.NaN)).toBe(0);
  });
});

describe("evidenceToBytes32", () => {
  const ZERO = `0x${"00".repeat(32)}`;

  it("returns the zero word for null / empty / malformed input", () => {
    expect(evidenceToBytes32(null)).toBe(ZERO);
    expect(evidenceToBytes32(undefined)).toBe(ZERO);
    expect(evidenceToBytes32("")).toBe(ZERO);
    expect(evidenceToBytes32("abc")).toBe(ZERO);
    expect(evidenceToBytes32(SHA_A.slice(0, 63))).toBe(ZERO); // 63 chars
  });

  it("accepts 64 hex chars with or without 0x, lowercased", () => {
    expect(evidenceToBytes32(SHA_A)).toBe(`0x${SHA_A}`);
    expect(evidenceToBytes32(`0x${SHA_A}`)).toBe(`0x${SHA_A}`);
    expect(evidenceToBytes32("A".repeat(64))).toBe(`0x${"a".repeat(64)}`);
  });
});
