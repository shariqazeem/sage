import { describe, expect, it } from "vitest";
import { decodeMissionTerms } from "./vault";

/**
 * WHAT THE CHAIN SAID, NOT WHAT WE HOPED IT SAID.
 *
 * This rail has already been closed twice by a decoding assumption. `decodeVaultStatus` assumed a
 * number, starknet.js handed it a CairoCustomEnum, `Number(object)` went NaN -> 0, and every vault
 * read as paused. Then the checked-in ABI drifted from the deployed contract and reads returned
 * nothing at all.
 *
 * `Boolean(m.exists)` was the same trap with the fuse still in: `Boolean("0x0")` is TRUE. This
 * decoder runs at ATTACH, where the verdict decides whether a founder's plan is actually backed by
 * the vault they funded — so a fabricated "exists" is a founder told their campaign is live when
 * some of its missions can never pay anyone.
 */

const mission = (over: Record<string, unknown> = {}) => ({
  reward: BigInt(2_500_000),
  max_completions: BigInt(4),
  paid_completions: BigInt(1),
  exists: true,
  ...over,
});

describe("decodeMissionTerms — the shapes a client actually returns", () => {
  it("reads the shape starknet.js returns today", () => {
    expect(decodeMissionTerms(mission())).toEqual({
      exists: true,
      rewardBase: BigInt(2_500_000),
      maxCompletions: 4,
      paidCompletions: 1,
    });
  });

  it("reads numeric and hex-string encodings of the same mission", () => {
    const expected = { exists: true, rewardBase: BigInt(2_500_000), maxCompletions: 4, paidCompletions: 1 };
    expect(decodeMissionTerms(mission({ reward: 2_500_000, max_completions: 4, paid_completions: 1, exists: 1 }))).toEqual(expected);
    expect(decodeMissionTerms(mission({ reward: "0x2625a0", max_completions: "0x4", paid_completions: "0x1", exists: "0x1" }))).toEqual(expected);
    expect(decodeMissionTerms(mission({ reward: "2500000", max_completions: "4", paid_completions: "1", exists: "true" }))).toEqual(expected);
  });

  it("reads a camelCase struct, in case the client renames the fields", () => {
    expect(
      decodeMissionTerms({ reward: BigInt(10), maxCompletions: BigInt(2), paidCompletions: BigInt(0), exists: true }),
    ).toEqual({ exists: true, rewardBase: BigInt(10), maxCompletions: 2, paidCompletions: 0 });
  });
});

describe("decodeMissionTerms — a mission the vault does not have", () => {
  it('does NOT read "0x0" as present — Boolean("0x0") is true, which is the whole trap', () => {
    expect(decodeMissionTerms(mission({ exists: "0x0" })).exists).toBe(false);
  });

  it("reads every falsy encoding as absent", () => {
    for (const v of [false, BigInt(0), 0, "0", "0x0", "false"]) {
      expect(decodeMissionTerms(mission({ exists: v })).exists, `exists=${String(v)}`).toBe(false);
    }
  });

  it("returns zeroed terms for an absent mission rather than the struct's leftovers", () => {
    // A vault returns the zero struct for an unknown mission; reading those as terms would invent
    // a mission that is not there.
    expect(decodeMissionTerms(mission({ exists: false }))).toEqual({
      exists: false,
      rewardBase: BigInt(0),
      maxCompletions: 0,
      paidCompletions: 0,
    });
  });
});

describe("decodeMissionTerms — unreadable throws, and never guesses", () => {
  it("throws on a shape that is not a struct at all", () => {
    for (const v of [null, undefined, 42, "nope", true]) {
      expect(() => decodeMissionTerms(v), `raw=${String(v)}`).toThrow(/unreadable/);
    }
  });

  it("throws rather than defaulting a missing field", () => {
    expect(() => decodeMissionTerms({ max_completions: BigInt(1), paid_completions: BigInt(0), exists: true })).toThrow(/reward/);
    expect(() => decodeMissionTerms({ reward: BigInt(1), paid_completions: BigInt(0), exists: true })).toThrow(/max_completions/);
    expect(() => decodeMissionTerms({ reward: BigInt(1), max_completions: BigInt(1), exists: true })).toThrow(/paid_completions/);
  });

  it("throws on an exists it cannot read, instead of picking a direction", () => {
    // Both directions are wrong: a fabricated true attaches a plan the vault cannot pay, a
    // fabricated false refuses a campaign that is perfectly funded.
    expect(() => decodeMissionTerms(mission({ exists: "maybe" }))).toThrow(/exists/);
    expect(() => decodeMissionTerms(mission({ exists: {} }))).toThrow(/exists/);
  });

  it("throws on a reward that is not an integer", () => {
    expect(() => decodeMissionTerms(mission({ reward: 2.5 }))).toThrow(/reward/);
    expect(() => decodeMissionTerms(mission({ reward: {} }))).toThrow(/reward/);
  });
});
