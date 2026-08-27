import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveVisionProvider } from "./vision";

/**
 * A provider that accepts an image and quietly ignores it is worse than one that errors.
 *
 * MEASURED 2026-08-28: MiniMax-M3 answers a multimodal request with HTTP 200 and the text "I don't
 * actually see any image attached." It is also the sponsored, zero-cost provider, which makes
 * pointing the VISION lane at it the obvious cost saving — and would leave Sage's eyes blind while
 * every call still looked successful, feeding the mission brain descriptions of nothing.
 */
const VARS = ["VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "MISSION_MODEL", "DEPUTY_MODEL", "COMMONSTACK_API_KEY", "COMMONSTACK_BASE_URL"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = {}; for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; } vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } vi.restoreAllMocks(); });

describe("vision refuses a provider that cannot see", () => {
  it("returns null for a lane pointed at a text-only model", () => {
    process.env.VISION_API_KEY = "k";
    process.env.VISION_BASE_URL = "https://api.minimax.io/v1";
    process.env.VISION_MODEL = "MiniMax-M3";
    expect(resolveVisionProvider()).toBeNull();
  });

  it("returns null when the SHARED chain resolves to a text-only model", () => {
    process.env.LLM_API_KEY = "k";
    process.env.LLM_BASE_URL = "https://api.minimax.io/v1";
    process.env.LLM_MODEL = "MiniMax-M3";
    expect(resolveVisionProvider()).toBeNull();
  });

  it("allows a genuinely multimodal provider", () => {
    process.env.LLM_API_KEY = "k";
    process.env.LLM_BASE_URL = "https://api.commonstack.ai/v1";
    process.env.VISION_MODEL = "google/gemini-3.1-flash-lite-preview";
    expect(resolveVisionProvider()?.model).toContain("gemini");
  });

  it("still returns null when no key is configured at all", () => {
    expect(resolveVisionProvider()).toBeNull();
  });
});
