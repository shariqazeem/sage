import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { conciergeKey, conciergeBase, conciergeModel } from "./concierge-config";

const VARS = [
  "CONCIERGE_API_KEY",
  "LLM_API_KEY",
  "COMMONSTACK_API_KEY",
  "CONCIERGE_BASE_URL",
  "LLM_BASE_URL",
  "COMMONSTACK_BASE_URL",
  "CONCIERGE_MODEL",
  "LLM_MODEL",
  "DEPUTY_MODEL",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("concierge-config — reserved-budget key resolution", () => {
  it("PREFERS CONCIERGE_API_KEY (its own budget) over the shared judgment chain", () => {
    process.env.LLM_API_KEY = "shared-judgment-key";
    process.env.CONCIERGE_API_KEY = "reserved-concierge-key";
    expect(conciergeKey()).toBe("reserved-concierge-key");
  });

  it("falls back to today's chain UNCHANGED when CONCIERGE_API_KEY is unset", () => {
    process.env.LLM_API_KEY = "shared-judgment-key";
    expect(conciergeKey()).toBe("shared-judgment-key");
    delete process.env.LLM_API_KEY;
    process.env.COMMONSTACK_API_KEY = "cs-key";
    expect(conciergeKey()).toBe("cs-key");
  });

  it("base prefers CONCIERGE_BASE_URL, else falls back, always trimming trailing slashes", () => {
    process.env.LLM_BASE_URL = "https://shared.example/v1/";
    expect(conciergeBase()).toBe("https://shared.example/v1");
    process.env.CONCIERGE_BASE_URL = "https://reserved.example/v1";
    expect(conciergeBase()).toBe("https://reserved.example/v1");
  });

  it("model resolution is unchanged (CONCIERGE_MODEL → LLM_MODEL → DEPUTY_MODEL → default)", () => {
    expect(conciergeModel()).toBe("deepseek/deepseek-v4-flash");
    process.env.DEPUTY_MODEL = "d";
    expect(conciergeModel()).toBe("d");
    process.env.CONCIERGE_MODEL = "anthropic/claude-haiku-4-5";
    expect(conciergeModel()).toBe("anthropic/claude-haiku-4-5");
  });
});
