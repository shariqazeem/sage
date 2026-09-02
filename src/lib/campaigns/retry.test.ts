import { describe, expect, it } from "vitest";
import { retryVerdict, MAX_ATTEMPTS } from "./retry";

describe("retryVerdict — refused or held gig work can be revised; approved, paid and fraud holds cannot", () => {
  const sub = (status: string, attempt = 1) => ({ status, attempt }) as never;
  it("allows a refused submission and a plain hold, up to the attempt cap", () => {
    expect(retryVerdict(sub("rejected"), { recommendation: "hold" }).ok).toBe(true);
    expect(retryVerdict(sub("pending"), { recommendation: "review", fraudSignals: [{ severity: "low" }] }).ok).toBe(true);
    expect(retryVerdict(sub("pending"), null).ok).toBe(true);
    expect(retryVerdict(sub("rejected", MAX_ATTEMPTS), { recommendation: "hold" }).ok).toBe(false);
  });
  it("refuses paid, settling, approved, and fraud holds", () => {
    expect(retryVerdict(sub("paid"), null).ok).toBe(false);
    expect(retryVerdict(sub("settling"), null).ok).toBe(false);
    expect(retryVerdict(sub("pending"), { recommendation: "pay" }).ok).toBe(false);
    expect(retryVerdict(sub("pending"), { recommendation: "hold", fraudSignals: [{ severity: "high" }] }).ok).toBe(false);
  });
});
