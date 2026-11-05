import { describe, expect, it } from "vitest";
import { honestHoldReason } from "./hold-reason";

const GATE = "LLM pending — Sage holds until verification is available";
const brief = (over: Partial<Parameters<typeof honestHoldReason>[1]>) => ({ engine: "heuristic" as const, model: null, summary: "", fraudSignals: [], recommendation: "hold" as const, ...over });

describe("a hold says its real reason", () => {
  it("a failed work-proof is named as itself, not 'LLM pending'", () => {
    const r = honestHoldReason(GATE, brief({ model: "workproof-verifier", summary: "Work-proof verification failed (deterministic check, no model consulted): That transaction happened before this job was posted." }));
    expect(r).toMatch(/before this job was posted/);
    expect(r).not.toMatch(/LLM pending/);
  });

  it("an unbound mission is named as itself", () => {
    const r = honestHoldReason(GATE, brief({ summary: "Held: could not be bound to a verified mission.", fraudSignals: [{ signal: "mission context unavailable", severity: "high", reason: "x" }] }));
    expect(r).toMatch(/could not be bound/);
  });

  it("keeps 'LLM pending' when the judge really was unavailable", () => {
    expect(honestHoldReason(GATE, brief({ summary: "keyword heuristic" }))).toBe(GATE);
  });

  it("never touches a reason the LLM path produced", () => {
    expect(honestHoldReason("confidence 70% below the 85% autopilot threshold", brief({ engine: "llm" as never }))).toMatch(/below the 85%/);
  });
});
