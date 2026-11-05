import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A NAMED PLAN IS LAUNCHED OR REFUSED, NEVER SWAPPED.
 *
 * `sage_fund_and_launch` used to launch the founder's newest ready plan whenever the id the model carried
 * couldn't launch: different work, possibly a different amount, from the founder's money (5 Nov 2026).
 * Selection is plain control flow over DB state, so it is pinned at the source.
 */
describe("sage_fund_and_launch launches exactly the plan it was given", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/telegram/agent-wallet-tools.ts"), "utf8");

  it("no longer swaps a named plan that can't launch for the latest one", () => {
    expect(src).not.toMatch(/askedFor && autoApprove\(askedFor, b\.founderAddress\)\s*\?\s*askedFor\s*:\s*latestLaunchablePlan/);
  });

  it("refuses a named plan that can't launch, before anything moves, and names the ready one", () => {
    const refusal = src.indexOf("if (askedFor && !autoApprove(askedFor, b.founderAddress)) {");
    const firstMoney = src.indexOf("launchAllowed(b.founderAddress, budget)");
    expect(refusal).toBeGreaterThan(0);
    expect(firstMoney).toBeGreaterThan(refusal);
    expect(src).toMatch(/planNotLaunchable: true/);
    expect(src).toMatch(/readyPlanId:/);
  });

  it("still launches the newest ready plan when the founder named none (\"launch it\")", () => {
    expect(src).toMatch(/const resolved = askedFor \|\| latestLaunchablePlan\(b\.founderAddress\);/);
  });
});
