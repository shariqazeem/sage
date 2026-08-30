import { describe, expect, it } from "vitest";

import { FELT_MASK, STARKNET_PRIME, feltOf, isFelt, missionFelt, toFelt } from "./felt";

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

describe("the guard can never reject what toFelt produces", () => {
  /**
   * `planVaultDeployment` now refuses a mission id that is not a felt. That guard is only safe if
   * the reduction every caller uses ALWAYS produces one — otherwise it would start refusing real
   * deploys instead of catching mistakes.
   *
   * It holds by construction: toFelt masks to 251 bits, and 2^251 - 1 < 2^251 < PRIME. Pinned
   * anyway, because "obviously always true" is what the 252-bit mask looked like before it turned
   * out to admit roughly twice PRIME.
   */
  it("holds for the mask's own ceiling", () => {
    expect(isFelt(toFelt("0x" + "f".repeat(64)))).toBe(true);
    expect(BigInt(toFelt("0x" + "f".repeat(64)))).toBeLessThan(STARKNET_PRIME);
  });

  it("holds across the whole 256-bit input range", () => {
    const cases = [
      "0x0", "0x1",
      "0x" + "f".repeat(63),
      "0x" + "8" + "0".repeat(63),
      "0x39c8721bf3388ef78c49a7a69c2eaa0f74e51f6c21cafad763f1734a5c8a347d",
      "0x" + "a5".repeat(32),
      "0x" + "f".repeat(64),
    ];
    for (const c of cases) {
      expect(isFelt(toFelt(c)), c).toBe(true);
    }
  });

  it("still rejects a raw 256-bit hash that was NOT reduced", () => {
    // The whole point: the value a caller who forgot toFelt would pass.
    expect(isFelt("0x39c8721bf3388ef78c49a7a69c2eaa0f74e51f6c21cafad763f1734a5c8a347d")).toBe(false);
    expect(isFelt("0x" + "f".repeat(64))).toBe(false);
    expect(isFelt("not-hex")).toBe(false);
    expect(isFelt(null)).toBe(false);
  });
});
