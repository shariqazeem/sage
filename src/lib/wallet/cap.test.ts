import { describe, expect, it } from "vitest";
import { validateLowerCap } from "./cap";

describe("validateLowerCap", () => {
  it("accepts a strictly lower positive value", () => {
    expect(validateLowerCap(25, 10).ok).toBe(true);
    expect(validateLowerCap(100, 99.5).ok).toBe(true);
  });

  it("rejects equal or higher values (tighten-only is real)", () => {
    expect(validateLowerCap(25, 25).ok).toBe(false);
    expect(validateLowerCap(25, 30).ok).toBe(false);
  });

  it("rejects zero, negative, and non-finite", () => {
    expect(validateLowerCap(25, 0).ok).toBe(false);
    expect(validateLowerCap(25, -5).ok).toBe(false);
    expect(validateLowerCap(25, NaN).ok).toBe(false);
  });
});
