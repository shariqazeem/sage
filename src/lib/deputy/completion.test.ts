import { describe, it, expect } from "vitest";
import {
  readCompletion,
  isNormalCompletion,
  isKnownAbnormalCompletion,
  terminationRejectReason,
} from "./completion";

/**
 * The completion adapter (Gate C item 2) — preserves provider termination metadata and admits a money
 * decision ONLY on an explicit recognized normal completion. Absent/unknown/abnormal → fail closed.
 */
describe("readCompletion — preserves the provider's actual termination metadata", () => {
  it("extracts content, finish_reason, refusal, and token usage", () => {
    const c = readCompletion({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
    expect(c).toEqual({ content: "{}", finishReason: "stop", refusal: null, promptTokens: 5, completionTokens: 7 });
  });
  it("preserves an ABSENT finish_reason as null (does not invent one)", () => {
    const c = readCompletion({ choices: [{ message: { content: "{}" } }] });
    expect(c.finishReason).toBeNull();
  });
  it("preserves an explicit refusal", () => {
    const c = readCompletion({ choices: [{ message: { refusal: "no" }, finish_reason: "stop" }] });
    expect(c.refusal).toBe("no");
  });
  it("handles a malformed/empty response without throwing", () => {
    expect(readCompletion(undefined).content).toBeNull();
    expect(readCompletion({}).finishReason).toBeNull();
    expect(readCompletion({ choices: [] }).content).toBeNull();
  });
});

describe("isNormalCompletion — allow-list, not deny-list", () => {
  it("only explicit recognized-normal (stop) is normal", () => {
    expect(isNormalCompletion("stop")).toBe(true);
  });
  it("absent / unknown / abnormal are NOT normal", () => {
    for (const r of [null, undefined, "", "length", "max_tokens", "content_filter", "tool_calls", "function_call", "end_turn", "STOP", "some_new_reason"]) {
      expect(isNormalCompletion(r as string | null | undefined), `finish=${r}`).toBe(false);
    }
  });
});

describe("terminationRejectReason — the money-path admission decision", () => {
  const base = { content: "{}", refusal: null, promptTokens: 0, completionTokens: 0 };
  it("explicit stop → admitted (null reason)", () => {
    expect(terminationRejectReason({ ...base, finishReason: "stop" })).toBeNull();
  });
  it("absent finish_reason → rejected", () => {
    expect(terminationRejectReason({ ...base, finishReason: null })).toBe("finish_reason_absent");
  });
  it("truncation (length) → rejected", () => {
    expect(terminationRejectReason({ ...base, finishReason: "length" })).toBe("finish_reason_length");
  });
  it("unknown reason → rejected", () => {
    expect(terminationRejectReason({ ...base, finishReason: "weird" })).toBe("finish_reason_weird");
  });
  it("refusal outranks a normal finish_reason → rejected", () => {
    expect(terminationRejectReason({ ...base, finishReason: "stop", refusal: "I can't." })).toBe("refusal");
  });
  it("isKnownAbnormalCompletion flags the recognized abnormal set (diagnostics)", () => {
    expect(isKnownAbnormalCompletion("length")).toBe(true);
    expect(isKnownAbnormalCompletion("content_filter")).toBe(true);
    expect(isKnownAbnormalCompletion("stop")).toBe(false);
    expect(isKnownAbnormalCompletion(null)).toBe(false);
  });
});
