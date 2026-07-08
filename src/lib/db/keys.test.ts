import { describe, expect, it } from "vitest";
import { dedupeKey, nowSeconds, submissionIntentHash } from "./keys";

describe("dedupeKey", () => {
  it("is deterministic and case-insensitive on the wallet", () => {
    const a = dedupeKey("camp1", "0xABCDEF");
    const b = dedupeKey("camp1", "0xabcdef");
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("differs by campaign and by wallet", () => {
    expect(dedupeKey("camp1", "0xAAA")).not.toBe(dedupeKey("camp2", "0xAAA"));
    expect(dedupeKey("camp1", "0xAAA")).not.toBe(dedupeKey("camp1", "0xBBB"));
  });
});

describe("submissionIntentHash", () => {
  it("is deterministic per (campaign, submission), mirrors the bounty pattern", () => {
    expect(submissionIntentHash("c", "s")).toBe(submissionIntentHash("c", "s"));
    expect(submissionIntentHash("c", "s1")).not.toBe(
      submissionIntentHash("c", "s2"),
    );
    expect(submissionIntentHash("c", "s")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("nowSeconds", () => {
  it("returns integer unix seconds", () => {
    const n = nowSeconds();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(1_700_000_000);
  });
});
