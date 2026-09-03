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

describe("the declared split class", () => {
  it("is recognised as capable", () => {
    // Read back off chain before it was written here: 19 entrypoints, request_payout_to present.
    expect(
      classSupportsSplitPayout("0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87"),
    ).toBe(true);
  });

  it("is a DIFFERENT class from the one the live campaign runs", () => {
    // If these ever collapsed to the same value, the guard would be waved through for a vault that
    // cannot serve the call — the exact failure it exists to prevent.
    const split = "0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87";
    const legacy = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";
    expect(split).not.toBe(legacy);
    expect(classSupportsSplitPayout(split)).toBe(true);
    expect(classSupportsSplitPayout(legacy)).toBe(false);
  });

  it("the privacy class (declared 2026-09-02) is capable — the first campaign on it paid publicly because it was missing here", () => {
    expect(classSupportsSplitPayout("0x6d55773e63601dfbd861c78e03c5ac3085b472d7c067d9c5634da03a00b5aa0", null)).toBe(true);
    expect(classSupportsSplitPayout("0x06D55773E63601DFBD861C78E03C5AC3085B472D7C067D9C5634DA03A00B5AA0", null)).toBe(true);
  });

  it("whatever class the deployer is configured with is capable by construction — the list cannot drift behind the deployer again", () => {
    const fresh = "0x0abc0000000000000000000000000000000000000000000000000000000000ff";
    expect(classSupportsSplitPayout(fresh, null)).toBe(false);
    expect(classSupportsSplitPayout(fresh, fresh)).toBe(true);
    expect(classSupportsSplitPayout("0xabc0000000000000000000000000000000000000000000000000000000000ff", fresh)).toBe(true);
    // a known pre-split class stays incapable even if the env names it
    const pre = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";
    expect(classSupportsSplitPayout(pre, pre)).toBe(false);
  });
});
