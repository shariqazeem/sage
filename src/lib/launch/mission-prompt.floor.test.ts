import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHITECT_SYSTEM, MISSION_PROMPT_VERSION } from "./mission-prompt";

/**
 * The count rule has TWO edges. v4.2 added the ceiling ("distinct means distinct") after a plan
 * carried three missions that all ended on the registration page. P-GEN 45 then showed the other
 * edge: the same rule read as "one flow → one mission" collapsed an 18-state interactive world into
 * a single onboarding mission, which died on one missing field and left the founder nothing. The
 * floor sentence and the gate-only corrective steer are the fix; this pins both so a later prompt
 * edit cannot silently drop either edge.
 */
describe("architect count rule — a ceiling AND a floor", () => {
  it("pins the version and both edges of the rule", () => {
    expect(MISSION_PROMPT_VERSION).toBe("mb-v4.4-qa");
    expect(ARCHITECT_SYSTEM).toMatch(/DISTINCT means distinct/);
    expect(ARCHITECT_SYSTEM).toMatch(/eight or more distinct states never yields fewer than three missions/);
    expect(ARCHITECT_SYSTEM).toMatch(/linear intake\/onboarding is ONE mission/i);
  });

  it("the corrective round steers a gate-only death differently from a critic rejection", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/launch/mission-brain.ts"), "utf8");
    expect(src).toMatch(/The reviewer ACCEPTED these missions — they failed only on the listed fields\. RE-EMIT each one with EVERY field filled in/);
    expect(src).toMatch(/Design DIFFERENT missions that survive that review/);
  });
});
