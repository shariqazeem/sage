import { describe, expect, it } from "vitest";
import { urlLaneRetry } from "./retry-coaching";

// The shapes below are the live rows from the first Starknet gig (2026-09-03), which is where the
// board's silence was noticed: a refused paste, a copy-held paste with an approving brief, a hold on
// unmet criteria, and the paid ones.
const pay = { recommendation: "pay", summary: "All acceptance criteria are satisfied: the artifact is live.", criteria: [{ criterion: "names sagepays.xyz", met: true }] };

describe("urlLaneRetry — the worker's next move, in words", () => {
  it("a refused submission carries the founder's own reason and the attempts left", () => {
    const r = urlLaneRetry(
      { status: "rejected", attempt: 1, rejectReason: "paste.rs is a temporary paste service — republish on a durable page and resubmit." },
      pay,
      null,
    );
    expect(r?.retryable).toBe(true);
    expect(r?.attemptsLeft).toBe(2);
    expect(r?.coaching).toMatch(/^paste\.rs is a temporary paste service/);
    expect(r?.coaching).toMatch(/2 attempts left/);
  });

  it("a payout the copy gate held names the copy signal — the brief said pay, the money did not move", () => {
    const r = urlLaneRetry({ status: "pending", attempt: 1, rejectReason: null }, pay, "possible copied work — near-identical artifact to another submission (69% match)");
    expect(r?.coaching).toContain("held the payout: possible copied work");
  });

  it("a hold lists the criteria Sage could not confirm, never the raw reason code", () => {
    const r = urlLaneRetry(
      { status: "pending", attempt: 1, rejectReason: null },
      {
        recommendation: "hold",
        summary: "Recommend hold. Fails the platform requirement.",
        criteria: [
          { criterion: "The page carries the submitting wallet address", met: false },
          { criterion: "names sagepays.xyz", met: false },
          { criterion: "contains the exact phrase", met: true },
        ],
      },
      null,
    );
    expect(r?.retryable).toBe(true);
    expect(r?.coaching).toContain("couldn't confirm 2 things");
    expect(r?.coaching).toContain("submitting wallet address");
    expect(r?.coaching).not.toMatch(/partial_criteria|evidence_mismatch/);
  });

  it("with no unmet criterion the judge's first sentence is the reason", () => {
    const r = urlLaneRetry({ status: "pending", attempt: 1, rejectReason: null }, { recommendation: "review", summary: "The wallet on the page differs from the submitting wallet. More text here." }, null);
    expect(r?.coaching).toMatch(/^The wallet on the page differs from the submitting wallet\./);
  });

  it("the last attempt is final: the reason stays, the invitation to resubmit does not", () => {
    const r = urlLaneRetry({ status: "rejected", attempt: 3, rejectReason: "Not a page." }, pay, null);
    expect(r?.retryable).toBe(false);
    expect(r?.attemptsLeft).toBe(0);
    expect(r?.coaching).toMatch(/^Not a page\./);
    expect(r?.coaching).toMatch(/all 3 attempts/);
  });

  it("a high fraud signal cannot be revised away", () => {
    const r = urlLaneRetry({ status: "pending", attempt: 1, rejectReason: null }, { recommendation: "hold", fraudSignals: [{ severity: "high" }], criteria: [] }, null);
    expect(r?.retryable).toBe(false);
    expect(r?.coaching).toMatch(/fraud signal/);
  });

  it("paid, settling and still-being-judged submissions have nothing to revise", () => {
    expect(urlLaneRetry({ status: "paid", attempt: 1, rejectReason: null }, pay, null)).toBeNull();
    expect(urlLaneRetry({ status: "settling", attempt: 1, rejectReason: null }, pay, null)).toBeNull();
    expect(urlLaneRetry({ status: "pending", attempt: 1, rejectReason: null }, null, null)).toBeNull();
    expect(urlLaneRetry({ status: "pending", attempt: 1, rejectReason: null }, pay, null)).toBeNull();
  });
});
