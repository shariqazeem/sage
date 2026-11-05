import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOPAY_THRESHOLD_FLOOR, effectiveThreshold, validateThreshold } from "./validate";
import { AUTOPAY_THRESHOLD, hardenBrief } from "@/lib/deputy/brain-core";
import { gateFromBrief } from "@/lib/deputy/autopilot";

/**
 * NOTHING LOWERS THE AUTOPAY BAR BELOW THE INVARIANT.
 *
 * Found 5 Nov 2026 by reading the money path, not by a failure:
 * - the per-job threshold could be stored anywhere from 0.5 up;
 * - a PATCH that omitted it stored 0.5 (`Number("")` is 0, not NaN);
 * - 0.5 is exactly where `hardenBrief` caps a brief whose evidence couldn't be fetched, and the gate
 *   compares with `<`, so that cap stopped blocking a payout.
 */
describe("the autopay threshold floor", () => {
  it("is the invariant CLAUDE.md states (brain-core's AUTOPAY_THRESHOLD)", () => {
    expect(AUTOPAY_THRESHOLD_FLOOR).toBe(AUTOPAY_THRESHOLD);
  });

  it("reads a missing, empty or unparseable value as the floor, never as zero", () => {
    for (const raw of [undefined, null, "", "   ", "abc", NaN, {}]) expect(validateThreshold(raw)).toBe(0.85);
  });

  it("never stores a looser bar than the floor, and keeps a stricter one", () => {
    expect(validateThreshold(0.5)).toBe(0.85);
    expect(validateThreshold("0.6")).toBe(0.85);
    expect(validateThreshold(0.9)).toBe(0.9);
    expect(validateThreshold(1)).toBe(0.99);
  });

  it("reads a job stored before the floor at the floor, so the gate never acts on 0.5", () => {
    expect(effectiveThreshold(0.5)).toBe(0.85);
    expect(effectiveThreshold(0.95)).toBe(0.95);
  });

  it("a brief whose evidence couldn't be fetched can never autopay through the effective threshold", () => {
    const brief = hardenBrief(
      {
        criteria: [{ criterion: "c", met: true, confidence: 0.99 }],
        fraudSignals: [],
        recommendation: "pay",
        reasonCode: "all_criteria_met",
        confidence: 0.99,
        summary: "s",
        engine: "llm",
        model: "m",
        provider: "p",
        evidenceOk: false,
        contentSha256: null,
        latencyMs: 1,
        costUsd: 0,
        x402PaymentTx: null,
      },
      { criteria: ["c"], evidenceUrl: null, note: null, evidenceText: null, evidenceOk: false } as unknown as Parameters<typeof hardenBrief>[1],
    );
    expect(brief.confidence).toBeLessThanOrEqual(0.5);
    const gate = gateFromBrief(brief, { autonomy: "autopilot", autopilotThreshold: effectiveThreshold(0.5) }, "pending", true);
    expect(gate.pay).toBe(false);
  });

  it("the payout pipeline hands the gate the effective threshold, not the stored one", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/deputy/pipeline.ts"), "utf8");
    expect(src).toMatch(/autopilotThreshold: effectiveThreshold\(campaign\.autopilotThreshold\)/);
  });
});
