import { describe, expect, it } from "vitest";

import {
  claimCommitment,
  claimUrl,
  generateSecret,
  mintClaimSecrets,
  refundCommitment,
  secretFromUrl,
} from "./claim-link";

/** 2^251 + 17·2^192 + 1 — a felt252 must be strictly below this. */
const STARK_PRIME = BigInt(
  "3618502788666131213697322783095070105623107215331596699973092056135872020481",
);

describe("commitments agree with the Cairo contract", () => {
  /**
   * THE TEST THAT MATTERS. These are not values this module produced and then recorded — they were
   * read out of `contracts-starknet/src/claims.cairo` by running it, and the same three are
   * asserted there in `commitments_match_the_pinned_vectors`. If the two derivations ever diverge,
   * Sage escrows real money to a commitment whose preimage does not open it: no error at deposit
   * time, and nobody can ever collect. Both suites go red together or the pin is worthless.
   */
  it("reproduces the pinned vectors exactly", () => {
    expect(claimCommitment("sage-vector-1")).toBe(
      "3320238942575134960334128461057374995108359740439534656937595193287851709783",
    );
    expect(refundCommitment("sage-vector-1")).toBe(
      "3528550685409820502922574992525543883544470031925252292192837564121368762142",
    );
    expect(claimCommitment("0x1")).toBe(
      "3495104234677916629716606448466696190085183457604658688403680060612153238036",
    );
  });

  it("keeps the two hash domains apart", () => {
    // The same preimage must never be valid on both paths. Collapsing the tags would let a secret
    // that opens one door open the other.
    const secret = generateSecret();
    expect(claimCommitment(secret)).not.toBe(refundCommitment(secret));
  });
});

describe("secrets", () => {
  it("stays inside the felt field", () => {
    // A draw above the STARK prime is not a felt. The contract would reject it, but only after
    // Sage had already told a worker their money was waiting.
    for (let i = 0; i < 200; i++) {
      expect(BigInt(generateSecret())).toBeLessThan(STARK_PRIME);
    }
  });

  it("uses the full 248 bits rather than a truncated draw", () => {
    // A generator that silently lost entropy would still produce valid-looking hex. Sampling the
    // top byte across many draws catches a width that collapsed.
    const tops = new Set<string>();
    for (let i = 0; i < 100; i++) tops.add(generateSecret().slice(2, 4));
    expect(tops.size).toBeGreaterThan(20);
    expect(generateSecret()).toMatch(/^0x[0-9a-f]{62}$/);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateSecret()));
    expect(seen.size).toBe(500);
  });

  it("mints a claim and a refund secret that are different", () => {
    const s = mintClaimSecrets();
    expect(s.claimSecret).not.toBe(s.refundSecret);
    expect(s.claimCommitment).toBe(claimCommitment(s.claimSecret));
    expect(s.refundCommitment).toBe(refundCommitment(s.refundSecret));
    // The commitment must not be derivable from the wrong secret.
    expect(s.claimCommitment).not.toBe(claimCommitment(s.refundSecret));
  });
});

describe("the link", () => {
  it("puts the secret in the fragment, where a server never sees it", () => {
    const url = claimUrl("https://sagepays.xyz", "0xabc123");
    expect(url).toBe("https://sagepays.xyz/claim#0xabc123");
    // Anything before the '#' is what reaches the access log. The secret must not be in it.
    expect(url.split("#")[0]).not.toContain("abc123");
    expect(url).not.toContain("?");
  });

  it("round-trips", () => {
    const secret = generateSecret();
    expect(secretFromUrl(claimUrl("https://sagepays.xyz/", secret))).toBe(secret);
  });

  it("returns null rather than a half-read secret", () => {
    expect(secretFromUrl("https://sagepays.xyz/claim")).toBeNull();
    expect(secretFromUrl("https://sagepays.xyz/claim#")).toBeNull();
    expect(secretFromUrl("https://sagepays.xyz/claim#not-hex")).toBeNull();
  });
});
