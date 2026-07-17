import { describe, it, expect, afterEach } from "vitest";
import { missionModel } from "./mission-model";

const ORIG = process.env.MISSION_MODEL;
afterEach(() => {
  if (ORIG === undefined) delete process.env.MISSION_MODEL;
  else process.env.MISSION_MODEL = ORIG;
});

describe("missionModel — mission-design-only override", () => {
  it("is undefined when unset, so resolveLlm falls through to today's chain unchanged", () => {
    delete process.env.MISSION_MODEL;
    expect(missionModel()).toBeUndefined();
  });

  it("is undefined for an empty / whitespace value (no accidental empty-string model)", () => {
    process.env.MISSION_MODEL = "   ";
    expect(missionModel()).toBeUndefined();
  });

  it("returns the trimmed override when set (mirrors CONCIERGE_MODEL)", () => {
    process.env.MISSION_MODEL = "  anthropic/claude-haiku-4-5  ";
    expect(missionModel()).toBe("anthropic/claude-haiku-4-5");
  });
});
