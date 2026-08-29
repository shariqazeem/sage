import { describe, expect, it } from "vitest";

import { founderStorageKey, sameFounder } from "./founder";
import { ownsCampaign } from "@/lib/campaigns/review-actions";
import type { Campaign } from "@/lib/db/schema";

/**
 * THE CONSISTENCY SWEEP, AS TESTS.
 *
 * Identity was EVM-shaped in a dozen places, each correct on its own and each wrong for a felt in
 * the same way: `a.toLowerCase() === b.toLowerCase()` treats two spellings of one Starknet address
 * as two different people, because they differ only in leading zeros. The failure is not a crash —
 * it is a founder quietly told the campaign they created is not theirs.
 *
 * These pin the round trip a real founder makes: the address a wallet hands over, the key it is
 * stored under, and the comparison that later decides whether they own what they made.
 */

const EVM = "0x3a60aF43c67dd9D552f180d30d9A042948078341";
const EVM_ZERO = "0x0a60aF43c67dd9D552f180d30d9A042948078341"; // ~1 in 16 addresses start with 0
const SN_PADDED = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
const SN_BARE = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

const campaignOwnedBy = (posterWallet: string) => ({ posterWallet }) as Campaign;

describe("a founder owns what they created, whichever wallet they used", () => {
  it("recognises a Starknet founder whose wallet returns the OTHER padding", () => {
    // The exact lockout this work exists to prevent.
    const campaign = campaignOwnedBy(founderStorageKey(SN_PADDED));
    expect(ownsCampaign(campaign, SN_PADDED)).toBe(true);
    expect(ownsCampaign(campaign, SN_BARE)).toBe(true);
  });

  it("still recognises an EVM founder, in any casing", () => {
    const campaign = campaignOwnedBy(founderStorageKey(EVM));
    expect(ownsCampaign(campaign, EVM)).toBe(true);
    expect(ownsCampaign(campaign, EVM.toLowerCase())).toBe(true);
  });

  it("does NOT hand a campaign to someone else", () => {
    const campaign = campaignOwnedBy(founderStorageKey(SN_PADDED));
    expect(ownsCampaign(campaign, EVM)).toBe(false);
    expect(ownsCampaign(campaign, SN_BARE.replace(/8$/, "9"))).toBe(false);
    expect(ownsCampaign(campaign, null)).toBe(false);
    expect(ownsCampaign(campaign, "anonymous")).toBe(false);
  });

  it("does not treat an unsigned visitor as the owner of an unowned campaign", () => {
    // Two absent values must never compare equal — that would make every anonymous visitor
    // the owner of any campaign with a missing poster.
    expect(ownsCampaign(campaignOwnedBy(""), null)).toBe(false);
    expect(ownsCampaign(campaignOwnedBy(""), "")).toBe(false);
  });
});

describe("the storage round trip", () => {
  it("writes a Starknet address under ONE key regardless of the spelling given", () => {
    // An indexed SQL equality compares bytes, so both spellings must agree before they reach it.
    expect(founderStorageKey(SN_PADDED)).toBe(founderStorageKey(SN_BARE));
  });

  it("leaves every EVM address byte-identical to how it was already stored", () => {
    // The backwards-compatibility guarantee: existing rows were written with toLowerCase() only.
    for (const a of [EVM, EVM_ZERO]) {
      expect(founderStorageKey(a)).toBe(a.toLowerCase());
    }
  });

  it("a stored key always still matches the address it was made from", () => {
    for (const a of [EVM, EVM_ZERO, SN_PADDED, SN_BARE]) {
      expect(sameFounder(founderStorageKey(a), a)).toBe(true);
    }
  });
});
