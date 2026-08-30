import { describe, expect, it } from "vitest";

import { FELT_MASK, STARKNET_PRIME, feltOf, missionFelt, toFelt } from "./felt";

/**
 * "FELT252" NAMES THE TYPE, NOT THE BOUND.
 *
 * Starknet's field prime is 2^251 + 17·2^192 + 1 — barely above 2^251 — so a value masked to 252
 * bits can be almost TWICE the prime and still look like it fits. It did: a real mission id came
 * out at 1.92× the prime, and Ready refused an entire vault deployment with "Default Felt
 * constructor accepts values smaller than Felt.PRIME" while a founder was funding a campaign.
 *
 * Everything here checks one property — nothing this module produces can ever exceed the field.
 */

const PRIME = STARKNET_PRIME;

/** The exact value from the failed deployment. */
const REPORTED = BigInt(
  "6951810612502425877638066291511815323822945331418527778001627856614507299150",
);

const asBig = (hex: string) => BigInt(hex);

describe("the mask itself", () => {
  it("cannot produce a value at or above the prime", () => {
    expect(FELT_MASK).toBeLessThan(PRIME);
  });

  it("is not the 252-bit mask that caused this", () => {
    // Pinned as a value, so a well-meaning "felt252 means 252 bits" edit fails here.
    expect(FELT_MASK).not.toBe((BigInt(1) << BigInt(252)) - BigInt(1));
  });
});

describe("toFelt", () => {
  it("brings the reported over-prime value back under the field", () => {
    const out = asBig(toFelt(REPORTED.toString()));
    expect(REPORTED).toBeGreaterThan(PRIME); // the input really was out of range
    expect(out).toBeLessThan(PRIME);
  });

  it("keeps every 256-bit input under the prime", () => {
    // Walk the top of the range, where the old mask failed and nothing else does.
    for (const shift of [255, 254, 253, 252, 251, 250]) {
      const v = (BigInt(1) << BigInt(shift)) - BigInt(1);
      expect(asBig(toFelt(v.toString())), `2^${shift}-1`).toBeLessThan(PRIME);
    }
  });

  it("is deterministic — the same input always maps to the same felt", () => {
    // The replay guarantee: the browser writes the mission id, settlement derives it again later.
    expect(toFelt(REPORTED.toString())).toBe(toFelt(REPORTED.toString()));
  });

  it("still separates two different inputs", () => {
    expect(toFelt("12345")).not.toBe(toFelt("12346"));
  });
});

describe("the id derivations built on it", () => {
  it("feltOf stays under the prime for long and awkward campaign ids", () => {
    for (const id of ["a", "launch-starkscan-co-khtlehsyucrr", "x".repeat(300), "🔥 unicode ✓"]) {
      expect(asBig(feltOf(id)), id.slice(0, 20)).toBeLessThan(PRIME);
    }
  });

  it("missionFelt stays under the prime for a real keccak-shaped hash", () => {
    const hash = `0x${"f".repeat(64)}`; // the largest 256-bit value there is
    expect(asBig(missionFelt(hash, "camp-1"))).toBeLessThan(PRIME);
    expect(asBig(missionFelt(null, "camp-1"))).toBeLessThan(PRIME);
  });
});
