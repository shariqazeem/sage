import { describe, expect, it } from "vitest";
import { CHECK_REASONS, failedCheckReason } from "./reasons";

describe("failedCheckReason", () => {
  it("maps each contract check index (1..6) to a distinct human reason", () => {
    const reasons = new Set<string>();
    for (let i = 1; i <= 6; i++) {
      expect(CHECK_REASONS[i]).toBeTruthy();
      reasons.add(failedCheckReason(i));
    }
    expect(reasons.size).toBe(6);
  });

  it("falls back for unknown/null indices", () => {
    expect(failedCheckReason(0)).toBe("a policy check failed");
    expect(failedCheckReason(null)).toBe("a policy check failed");
    expect(failedCheckReason(undefined)).toBe("a policy check failed");
    expect(failedCheckReason(99)).toBe("a policy check failed");
  });
});
