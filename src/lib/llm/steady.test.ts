import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { completeSteadily } from "./steady";

/**
 * Work that can wait a minute (the first look, the findings) waits out a provider's hiccup, then asks the
 * fallback provider once; anything that waiting cannot fix is thrown at once, as before.
 */
type Opts = Parameters<typeof completeSteadily>[1];
const OPTS: Opts = { system: "s", user: "u", lane: "DRAFT", model: "primary-model" };
const FALLBACK = { LLM_FALLBACK_API_KEY: "fk", LLM_FALLBACK_BASE_URL: "https://fallback.example/v1", LLM_FALLBACK_MODEL: "fallback-model" };

beforeEach(() => {
  process.env.LLM_RETRY_MAX_WAIT_MS = "5"; // the ladder's shape, without its seconds
  for (const k of Object.keys(FALLBACK)) delete process.env[k];
});
afterEach(() => {
  delete process.env.LLM_RETRY_MAX_WAIT_MS;
  for (const k of Object.keys(FALLBACK)) delete process.env[k];
});

describe("completeSteadily", () => {
  it("waits out a hiccup and returns the answer that follows it", async () => {
    let n = 0;
    const complete = vi.fn(async () => {
      if (n++ === 0) throw new Error("llm_status_500");
      return "worded";
    });
    expect(await completeSteadily(complete, OPTS)).toBe("worded");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("throws at once what waiting cannot fix: an empty account, a shape miss", async () => {
    for (const err of ["llm_status_402", "llm_unparseable_json"]) {
      const complete = vi.fn(async () => {
        throw new Error(err);
      });
      Object.assign(process.env, FALLBACK);
      await expect(completeSteadily(complete, OPTS)).rejects.toThrow(err);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });

  it("asks the fallback provider once when the primary keeps failing, without the primary's model", async () => {
    Object.assign(process.env, FALLBACK);
    const complete = vi.fn(async (o: Opts) => {
      if (o.useFallback) return "from-fallback";
      throw new Error("llm_status_500");
    });
    expect(await completeSteadily(complete, OPTS, { attempts: 3 })).toBe("from-fallback");
    expect(complete).toHaveBeenCalledTimes(4);
    const last = complete.mock.calls[3]![0];
    expect(last).toMatchObject({ useFallback: true, lane: "DRAFT", system: "s", user: "u" });
    expect(last.model).toBeUndefined();
  });

  it("throws the primary's failure when no fallback is configured", async () => {
    const complete = vi.fn(async () => {
      throw new Error("llm_status_503");
    });
    await expect(completeSteadily(complete, OPTS, { attempts: 2 })).rejects.toThrow("llm_status_503");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("never asks the fallback twice: a call already on it ends with its own failure", async () => {
    Object.assign(process.env, FALLBACK);
    const complete = vi.fn(async () => {
      throw new Error("llm_status_500");
    });
    await expect(completeSteadily(complete, { ...OPTS, useFallback: true }, { attempts: 2 })).rejects.toThrow("llm_status_500");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
