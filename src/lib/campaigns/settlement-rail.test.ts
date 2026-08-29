import { describe, expect, it } from "vitest";

import { railRationale, resolveSettlementRail } from "./settlement-rail";

describe("which rail pays a campaign", () => {
  /**
   * THE INVARIANT. "The budget lives in a contract you own" is the sentence this product rests on.
   * A better exit for testers is not a reason to move a founder's money out of their own vault —
   * that is their decision, not one to take from them at creation time.
   */
  const on = { starknetAvailable: true, recipientsOnStarknet: true };

  it("never moves a founder-funded campaign off their own vault", () => {
    expect(resolveSettlementRail({ ownerIsSage: false, ...on })).toBe("evm");
    expect(
      resolveSettlementRail({ ownerIsSage: false, starknetAvailable: false, recipientsOnStarknet: false }),
    ).toBe("evm");
  });

  it("puts Sage's own money on Starknet, where recipients can spend it", () => {
    expect(resolveSettlementRail({ ownerIsSage: true, ...on })).toBe("starknet");
  });

  /** A working rail beats a better one. An unconfigured deployment must not strand a campaign. */
  it("falls back to EVM when Starknet is not configured", () => {
    expect(
      resolveSettlementRail({ ownerIsSage: true, starknetAvailable: false, recipientsOnStarknet: true }),
    ).toBe("evm");
  });

  /**
   * THE ONE THAT WOULD HAVE BROKEN THE PRODUCT. Every tester today submits an EVM address, so a
   * rail chosen on ownership alone would leave settleOnStarknet correctly refusing every payout —
   * turning live campaigns into a queue of held work and unpaid people. An unpayable rail is not
   * a rail.
   */
  it("refuses Starknet when the recipients cannot receive on it", () => {
    expect(
      resolveSettlementRail({ ownerIsSage: true, starknetAvailable: true, recipientsOnStarknet: false }),
    ).toBe("evm");
  });

  it("is total — every combination resolves to a real rail", () => {
    for (const ownerIsSage of [true, false]) {
      for (const starknetAvailable of [true, false]) {
        for (const recipientsOnStarknet of [true, false]) {
          const input = { ownerIsSage, starknetAvailable, recipientsOnStarknet };
          const rail = resolveSettlementRail(input);
          expect(["evm", "starknet"]).toContain(rail);
          expect(railRationale(rail, input)).toBeTruthy();
        }
      }
    }
  });

  it("explains itself without naming a chain the founder must evaluate", () => {
    const why = railRationale("evm", { ownerIsSage: false, ...on });
    expect(why).toMatch(/vault you own/i);
    expect(why).not.toMatch(/GOAT|Metis|chain id/i);
  });
});
