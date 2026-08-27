import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { laneProvider, resolveLlm } from "./complete";

const LANE_VARS = [
  "PAYOUT", "CONCIERGE", "MISSION", "OBS_JUDGE", "VISION",
].flatMap((l) => [`${l}_API_KEY`, `${l}_BASE_URL`, `${l}_MODEL`]);
const SHARED = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "COMMONSTACK_API_KEY", "COMMONSTACK_BASE_URL", "DEPUTY_MODEL"];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of [...LANE_VARS, ...SHARED]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.LLM_API_KEY = "shared-key";
  process.env.LLM_BASE_URL = "https://shared.example.com/v1";
  process.env.LLM_MODEL = "shared-model";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("per-lane providers", () => {
  it("routes a fully-configured lane to its OWN provider", () => {
    process.env.MISSION_API_KEY = "mission-key";
    process.env.MISSION_BASE_URL = "https://minimax.example.com/v1";
    process.env.MISSION_MODEL = "MiniMax-M3";
    const p = resolveLlm(undefined, "MISSION");
    expect(p).toMatchObject({ key: "mission-key", model: "MiniMax-M3", endpoint: "https://minimax.example.com/v1/chat/completions" });
  });

  /**
   * THE SAFETY RULE. A half-configured lane must be treated as ABSENT, never merged. Merging would
   * splice one provider's key onto another provider's endpoint — which authenticates as nobody and
   * fails on a founder's launch rather than at boot.
   */
  it.each([
    ["key only", { MISSION_API_KEY: "k" }],
    ["base only", { MISSION_BASE_URL: "https://x.example.com/v1" }],
    ["model only", { MISSION_MODEL: "MiniMax-M3" }],
    ["key + model, no base", { MISSION_API_KEY: "k", MISSION_MODEL: "MiniMax-M3" }],
    ["base + model, no key", { MISSION_BASE_URL: "https://x.example.com/v1", MISSION_MODEL: "MiniMax-M3" }],
  ])("ignores a PARTIALLY configured lane (%s) and never splices credentials", (_label, vars) => {
    Object.assign(process.env, vars);
    expect(laneProvider("MISSION")).toBeNull();
    const p = resolveLlm(undefined, "MISSION");
    expect(p?.key).toBe("shared-key");
    expect(p?.endpoint).toBe("https://shared.example.com/v1/chat/completions");
  });

  it("keeps lanes INDEPENDENT — judgment and mission design can sit on different providers", () => {
    process.env.PAYOUT_API_KEY = "pay-key";
    process.env.PAYOUT_BASE_URL = "https://tuned.example.com/v1";
    process.env.PAYOUT_MODEL = "judge-model";
    process.env.MISSION_API_KEY = "mission-key";
    process.env.MISSION_BASE_URL = "https://sponsored.example.com/v1";
    process.env.MISSION_MODEL = "MiniMax-M3";
    expect(resolveLlm(undefined, "PAYOUT")?.key).toBe("pay-key");
    expect(resolveLlm(undefined, "MISSION")?.key).toBe("mission-key");
    expect(resolveLlm(undefined, "OBS_JUDGE")?.key).toBe("shared-key"); // unconfigured → inherits
  });

  it("is a no-op for callers that pass no lane (backward compatible)", () => {
    process.env.MISSION_API_KEY = "mission-key";
    process.env.MISSION_BASE_URL = "https://minimax.example.com/v1";
    process.env.MISSION_MODEL = "MiniMax-M3";
    expect(resolveLlm()?.key).toBe("shared-key");
    expect(resolveLlm("explicit-model")?.model).toBe("explicit-model");
  });

  it("lets an explicit per-call model win, while staying on the lane's provider", () => {
    process.env.MISSION_API_KEY = "mission-key";
    process.env.MISSION_BASE_URL = "https://minimax.example.com/v1";
    process.env.MISSION_MODEL = "MiniMax-M3";
    const p = resolveLlm("MiniMax-M3-thinking", "MISSION");
    expect(p?.model).toBe("MiniMax-M3-thinking");
    expect(p?.key).toBe("mission-key");
  });

  it("tolerates a trailing slash on a lane base url", () => {
    process.env.VISION_API_KEY = "v";
    process.env.VISION_BASE_URL = "https://vision.example.com/v1/";
    process.env.VISION_MODEL = "vision-model";
    expect(laneProvider("VISION")?.endpoint).toBe("https://vision.example.com/v1/chat/completions");
  });
});
