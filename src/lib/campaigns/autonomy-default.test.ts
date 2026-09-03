import { describe, expect, it } from "vitest";
import { defaultAutonomyFor } from "./autonomy-default";

describe("who decides the payout, by default", () => {
  it("the agent decides on every door — an open campaign is guarded by the finalization window, not a person", () => {
    expect(defaultAutonomyFor("unlisted")).toBe("autopilot");
    expect(defaultAutonomyFor("listed")).toBe("autopilot");
    expect(defaultAutonomyFor(undefined)).toBe("autopilot");
  });
});
