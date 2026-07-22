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
    vi.stubEnv("LLM_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const brief = await verifySubmission(input);
    expect(brief.engine).toBe("heuristic");
    expect(brief.provider).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * PROVIDER CHAIN — primary → fallback → heuristic. Demo-day insurance: when the
 * primary provider is exhausted, a DIFFERENT provider still returns a verified
 * LLM brief (engine "llm", so it can auto-pay); only when BOTH fail does the
 * Deputy drop to the heuristic (which can never auto-pay). Provider host + model
 * are recorded on the brief so a receipt can show which provider decided.
 */
describe("verifySubmission — provider chain (primary → fallback → heuristic)", () => {
  interface FetchResult {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }
  const okBrief = (): FetchResult => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              criteria: [
                {
                  criterion: "did the thing",
                  met: true,
                  confidence: 0.95,
                  quote: "the thing was done and merged",
                },
              ],
              fraudSignals: [],
              recommendation: "pay",
              reasonCode: "all_criteria_met",
              confidence: 0.95,
              summary: "verified",
            }),
          },
          finish_reason: "stop", // Gate C: money path requires explicit normal completion
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 60 },
    }),
  });
  const fail500: FetchResult = { ok: false, status: 500, json: async () => ({}) };

  const primaryEnv = () => {
    vi.stubEnv("COMMONSTACK_API_KEY", "");
    vi.stubEnv("COMMONSTACK_BASE_URL", "");
    vi.stubEnv("DEPUTY_MODEL", "");
    vi.stubEnv("LLM_API_KEY", "pk");
    vi.stubEnv("LLM_BASE_URL", "https://primary.test/v1");
    vi.stubEnv("LLM_MODEL", "primary/model");
  };
  const withFallback = () => {
    vi.stubEnv("LLM_FALLBACK_API_KEY", "fk");
    vi.stubEnv("LLM_FALLBACK_BASE_URL", "https://fallback.test/v1");
    vi.stubEnv("LLM_FALLBACK_MODEL", "fallback/model");
  };
  const noFallback = () => {
    vi.stubEnv("LLM_FALLBACK_API_KEY", "");
    vi.stubEnv("LLM_FALLBACK_BASE_URL", "");
    vi.stubEnv("LLM_FALLBACK_MODEL", "");
  };

  it("primary success → engine llm with primary provider + model recorded", async () => {
    primaryEnv();
    noFallback();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return okBrief();
    });
    const brief = await verifySubmission(input);
    expect(brief.engine).toBe("llm");
    expect(brief.model).toBe("primary/model");
    expect(brief.provider).toBe("primary.test");
    expect(brief.reasonCode).toBe("all_criteria_met");
    expect(brief.recommendation).toBe("pay");
    expect(calls.every((u) => u.includes("primary.test"))).toBe(true);
  });

  it("primary fails every attempt → fallback decides (engine llm, fallback model + provider)", async () => {
    primaryEnv();
    withFallback();
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return String(url).includes("primary.test") ? fail500 : okBrief();
    });
    const pending = verifySubmission(input);
    await vi.runAllTimersAsync();
    const brief = await pending;

    expect(brief.engine).toBe("llm"); // a fallback success can still auto-pay
    expect(brief.model).toBe("fallback/model");
    expect(brief.provider).toBe("fallback.test");
    expect(brief.recommendation).toBe("pay");
    // primary was retried LLM_ATTEMPTS times; the fallback was tried exactly once
    expect(calls.filter((u) => u.includes("primary.test")).length).toBe(3);
    expect(calls.filter((u) => u.includes("fallback.test")).length).toBe(1);
  });

  it("primary AND fallback both fail → heuristic, which the gate holds", async () => {
    primaryEnv();
    withFallback();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => fail500);
    const pending = verifySubmission(input);
    await vi.runAllTimersAsync();
    const brief = await pending;

    expect(brief.engine).toBe("heuristic"); // both providers down → honest degrade
    expect(brief.provider).toBeNull();
    const gate = gateFromBrief(
      brief,
      { autonomy: "autopilot", autopilotThreshold: 0.85 },
      "pending",
    );
    expect(gate.pay).toBe(false); // the heuristic can never auto-pay
  });

  it("no fallback configured + primary fails → heuristic (never throws)", async () => {
    primaryEnv();
    noFallback();
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return fail500;
    });
    const pending = verifySubmission(input);
    await vi.runAllTimersAsync();
    const brief = await pending;

    expect(brief.engine).toBe("heuristic");
    expect(brief.provider).toBeNull();
    expect(calls.every((u) => u.includes("primary.test"))).toBe(true); // never hit a fallback
  });
});
