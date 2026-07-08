import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySubmission } from "./brain";
import { gateFromBrief } from "./autopilot";
import type { BrainInput } from "./brain-core";

/**
 * FAILURE DRILL — the LLM brain degrades to the transparent heuristic on any
 * failure (timeout, network, bad output), and the autopilot gate then HOLDS
 * because the heuristic engine can never auto-pay. So an LLM outage can never
 * cause a wrong autonomous payout; it can only make the Deputy cautious.
 */

const input: BrainInput = {
  campaignTitle: "Ship a fix",
  criteria: ["did the thing"],
  conditionType: "approval",
  note: "here is my work",
  wallet: `0x${"a".repeat(40)}`,
  evidenceUrl: "https://example.org/pr/1",
  evidenceText: "the thing was done and merged",
  evidenceOk: true,
  contentSha256: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("verifySubmission — LLM failure drills", () => {
  it("timeouts on every retry attempt fall back to the heuristic, which the gate holds", async () => {
    vi.stubEnv("COMMONSTACK_API_KEY", "test-key");
    vi.useFakeTimers();
    // A fetch that never resolves on its own — it only rejects when the brain's
    // 20s AbortController fires, exactly like a real timeout. Every retry hangs.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("The operation was aborted")),
        );
      }),
    );

    const pending = verifySubmission(input);
    // Flush every attempt's timeout + the backoffs between them (robust to the
    // exact timeout/retry values), so the loop exhausts and degrades.
    await vi.runAllTimersAsync();
    const brief = await pending;

    expect(brief.engine).toBe("heuristic"); // degraded, honestly labeled
    // + HOLD: a heuristic brief can never clear the autopilot gate
    const gate = gateFromBrief(
      brief,
      { autonomy: "autopilot", autopilotThreshold: 0.85 },
      "pending",
    );
    expect(gate.pay).toBe(false);
    expect(gate.reason).toMatch(/LLM pending/i);
  });

  it("any LLM error (network down) falls back to the heuristic — never throws", async () => {
    vi.stubEnv("COMMONSTACK_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const brief = await verifySubmission(input);
    expect(brief.engine).toBe("heuristic");
    expect(["pay", "review", "hold"]).toContain(brief.recommendation);
  });

  it("with no LLM key, returns the heuristic WITHOUT any network call", async () => {
    vi.stubEnv("COMMONSTACK_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const brief = await verifySubmission(input);
    expect(brief.engine).toBe("heuristic");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
