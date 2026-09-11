import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TWO LISTS THAT DRIFTED, THIS TIME CAUGHT BEFORE IT COST ANYTHING. The composer's invite-only
 * toggle wrote `visibility` into the plan; no attach caller ever handed it to the campaign row, so
 * every "invite-only" campaign deployed listed and open (found 2026-09-04 while making unlisted work
 * members-only). Every caller of attachV2Campaign must pass the plan's visibility and derive the
 * autonomy default from it.
 */
const CALLERS = [
  "src/app/api/deployments/[deploymentId]/attach/route.ts",
  "src/app/api/launch/[id]/starknet/route.ts",
  "src/lib/privy/deploy-runner.ts",
];

describe("every attachV2Campaign caller carries the plan's visibility", () => {
  for (const f of CALLERS) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      const at = src.indexOf("attachV2Campaign(");
      expect(at, "calls attachV2Campaign").toBeGreaterThan(0);
      // The whole file, not a window after the call: since 2026-09-11 the Privy runner builds its
      // setup input in a helper (`setupInputFor`) so the record can be validated BEFORE any USDC
      // moves, and that helper — where `visibility: loaded.plan.visibility` lives — sits well past
      // the call. A window that stops short of it reads a correct file as a regression.
      expect(src, "passes visibility").toMatch(/visibility:\s*\w+(\.\w+)*\.visibility/);
      expect(src, "derives the autonomy default from visibility").toMatch(/defaultAutonomyFor\(/);
    });
  }
  it("the plan schema declares visibility, so the composer's toggle is typed all the way through", () => {
    expect(readFileSync("src/lib/launch/schemas.ts", "utf8")).toMatch(/visibility\?: "listed" \| "unlisted"/);
    expect(readFileSync("src/lib/campaigns/v2-setup.ts", "utf8")).toMatch(/visibility: input\.visibility \?\? "listed"/);
    expect(readFileSync("src/lib/launch/approve.ts", "utf8")).toMatch(/visibility: plan\.visibility/);
  });
});
