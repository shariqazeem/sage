import { describe, expect, it } from "vitest";
import { defaultAutonomyFor } from "./autonomy-default";

describe("who decides the payout, by default", () => {
  it("members-only work autopays; public work is released by the team", () => {
    expect(defaultAutonomyFor("unlisted")).toBe("autopilot");
    expect(defaultAutonomyFor("listed")).toBe("manual");
    expect(defaultAutonomyFor(undefined)).toBe("manual");
  });
});
