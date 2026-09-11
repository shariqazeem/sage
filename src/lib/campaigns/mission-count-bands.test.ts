import { describe, expect, it } from "vitest";
import { MAX_MISSIONS_SETUP } from "./v2-setup";
import { MISSION_COUNT_BANDS } from "@/lib/launch/mission-brain";
import { MAX_MISSIONS } from "./mission-plan";

/**
 * TWO LISTS THAT DRIFT — the dominant defect shape in this codebase. The architect is asked for a
 * band of missions; the campaign record has its own ceiling; the plan schema has a third. When the
 * band's top exceeded the record's ceiling, every inspected plan funded a vault and then failed to
 * be recorded. This test reads all three so the next drift fails here, not in a founder's account.
 */
describe("mission count: the planner's band fits the campaign record", () => {
  it("every band's upper bound is within the attach ceiling and the plan schema", () => {
    for (const band of Object.values(MISSION_COUNT_BANDS)) {
      const upper = Number(band.split(" to ")[1]);
      expect(Number.isFinite(upper), band).toBe(true);
      expect(upper, `band "${band}" exceeds MAX_MISSIONS_SETUP`).toBeLessThanOrEqual(MAX_MISSIONS_SETUP);
      expect(upper, `band "${band}" exceeds the plan schema's MAX_MISSIONS`).toBeLessThanOrEqual(MAX_MISSIONS);
    }
  });
});
