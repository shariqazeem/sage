import { describe, expect, it } from "vitest";
import { architectFailureDetail } from "./mission-brain";
import { LlmCompletionError } from "@/lib/llm/complete";

/**
 * A stored failure must say WHY. play2048 failed an entire P-GEN category with `invalid_json`,
 * `model: ""`, `latencyMs: 0` — a record that cannot distinguish a truncated answer from a
 * malformed one, so diagnosing it required reproducing it live against a real product.
 */
const err = (f: Partial<ConstructorParameters<typeof LlmCompletionError>[0]>) =>
  new LlmCompletionError({
    code: "llm_unparseable", httpStatus: 200, provider: "api.minimax.io", requestedModel: "MiniMax-M3",
    responseModel: "MiniMax-M3", finishReason: "stop", latencyMs: 900, promptTokens: 8000,
    completionTokens: 1200, parsePolicy: "repair", responseSchemaName: null, contentShape: "prose_wrapped",
    contentStructure: null, retryAfterMs: null, ...f,
  });

describe("architectFailureDetail", () => {
  it("distinguishes a TRUNCATED answer from a malformed one", () => {
    const truncated = architectFailureDetail(err({ finishReason: "length" }));
    const malformed = architectFailureDetail(err({ finishReason: "stop" }));
    expect(truncated).toContain("finish=length");
    expect(malformed).toContain("finish=stop");
    expect(truncated).not.toBe(malformed);
  });

  it("records the token count, so an under-sized budget is visible without a reproduction", () => {
    expect(architectFailureDetail(err({ completionTokens: 7200 }))).toContain("outTok=7200");
  });

  it("names the model the provider ACTUALLY served, not the one requested", () => {
    expect(architectFailureDetail(err({ responseModel: "minimax/minimax-m3" }))).toContain("served=minimax/minimax-m3");
  });

  it("falls back to a bounded message for a plain Error", () => {
    expect(architectFailureDetail(new Error("socket hang up"))).toBe("socket hang up");
  });

  it("stays short enough for a durable record", () => {
    const d = architectFailureDetail(err({ responseModel: "x".repeat(500) }));
    expect((d ?? "").length).toBeLessThanOrEqual(200);
  });

  it("returns undefined when there is nothing to report", () => {
    expect(architectFailureDetail(undefined)).toBeUndefined();
  });
});
