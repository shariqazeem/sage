import { describe, expect, it } from "vitest";
import { classSupportsSplitPayout } from "./vault-capability";

/**
 * `request_payout_to` exists only in the class declared on 2026-08-30. Every earlier vault —
 * including the live starkscan campaign — has no such entrypoint, and calling it there reverts as
 * an unknown selector. On the settlement path that is a worker whose cleared submission cannot be
 * paid, so the decision is made from the class the vault was deployed from, never from hope.
 */
describe("which vaults can split earner from destination", () => {
  it("treats the class the live campaign was deployed from as NOT capable", () => {
    // 0x2770f9fd… predates the split. This is the one that must never be asked.
    expect(
      classSupportsSplitPayout("0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84"),
    ).toBe(false);
  });

  it("treats anything unrecognised as NOT capable", () => {
    // Assuming capable and being wrong strands a payout. Assuming not-capable and being wrong pays
    // publicly — a worse privacy outcome, not a worse money outcome, and recoverable.
    for (const v of [null, undefined, "", "   ", "not-a-hash", "0x", `0x${"ab".repeat(31)}`]) {
      expect(classSupportsSplitPayout(v), JSON.stringify(v)).toBe(false);
    }
  });

  it("compares numerically, so leading zeros and casing cannot flip the answer", () => {
    // A class hash has many spellings; a capability decided by string equality would be capable on
    // Monday and not on Tuesday.
    const listed = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";
    expect(classSupportsSplitPayout(listed)).toBe(classSupportsSplitPayout(`0x0${listed.slice(2)}`));
    expect(classSupportsSplitPayout(listed)).toBe(classSupportsSplitPayout(listed.toUpperCase().replace("0X", "0x")));
  });
});
