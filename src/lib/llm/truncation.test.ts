import { describe, expect, it } from "vitest";
import { argsParse, hasUsableCall, truncationSignal } from "./truncation";

/**
 * The truncation reading production and P-DIRECT share. It exists because a provider does not
 * always admit it ran out of room: pd-gig-translator returned a tool call whose arguments end
 * mid-object under a clean finish_reason, production handed the tool `{}`, and the model spent its
 * remaining rounds being told the fields it HAD sent were missing.
 */
const choice = (over: Record<string, unknown> = {}) => ({
  message: { tool_calls: [{ function: { arguments: '{"kind":"gig"}' } }] },
  finish_reason: "stop",
  ...over,
}) as Parameters<typeof truncationSignal>[0];

describe("truncationSignal", () => {
  it("says nothing about a clean answer", () => {
    expect(truncationSignal(choice())).toBeNull();
    expect(truncationSignal(undefined)).toBeNull();
  });

  it("believes the provider when it says length — with and without a call", () => {
    expect(truncationSignal(choice({ finish_reason: "length" }))).toMatch(/tool call truncated/);
    expect(truncationSignal({ message: { tool_calls: [] }, finish_reason: "length" })).toMatch(/no call made/);
  });

  it("believes the ARGUMENTS over a clean finish_reason", () => {
    const cut = choice({ message: { tool_calls: [{ function: { arguments: '{"kind":"gig","milestones":[{"tit' } }] } });
    expect(truncationSignal(cut)).toMatch(/cut mid-JSON/);
  });

  it("treats a call with no arguments as a legitimate shape, not a cut", () => {
    expect(truncationSignal({ message: { tool_calls: [{ function: { arguments: "" } }] }, finish_reason: "stop" })).toBeNull();
    expect(truncationSignal({ message: { tool_calls: [{ function: {} }] }, finish_reason: "stop" })).toBeNull();
  });

  it("flags a cut in ANY of several calls, not just the first", () => {
    const two = {
      message: { tool_calls: [{ function: { arguments: "{}" } }, { function: { arguments: '{"a":' } }] },
      finish_reason: "stop",
    };
    expect(argsParse(two)).toBe(false);
    expect(truncationSignal(two)).toMatch(/cut mid-JSON/);
  });
});

describe("hasUsableCall — what may outrank a roomier retry", () => {
  it("a parsing call is usable", () => {
    expect(hasUsableCall(choice())).toBe(true);
  });

  it("a TRUNCATED call is not — it must never be kept over a roomier answer", () => {
    expect(hasUsableCall(choice({ message: { tool_calls: [{ function: { arguments: '{"kind":"gi' } }] } }))).toBe(false);
  });

  it("no call at all is not usable", () => {
    expect(hasUsableCall({ message: { tool_calls: [] }, finish_reason: "stop" })).toBe(false);
    expect(hasUsableCall({ message: null, finish_reason: "stop" })).toBe(false);
  });
});
