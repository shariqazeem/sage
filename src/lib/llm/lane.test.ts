import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANES, laneProvider, resolveLlm } from "./complete";
import { priorityForLane } from "./wire";
import { CEILING } from "./spend";

const LANE_VARS = LANES.flatMap((l) => [`${l}_API_KEY`, `${l}_BASE_URL`, `${l}_MODEL`]);
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

/**
 * TWO LISTS THAT DRIFT: the lane audit (scripts/lane-audit.mjs) cannot import this module, so it keeps
 * its own list. A lane it does not print is a lane nobody can see is on the wrong provider.
 */
describe("the lane audit", () => {
  it("prints every lane the app has", () => {
    const script = readFileSync(join(process.cwd(), "scripts/lane-audit.mjs"), "utf8");
    const listed = /const LANES = \[([^\]]*)\]/.exec(script)?.[1] ?? "";
    for (const lane of LANES) expect(listed).toContain(`"${lane}"`);
  });

  it("drafts a handed-over job on its own lane, inheriting the shared chain until it is configured", () => {
    expect(laneProvider("DRAFT")).toBeNull();
    expect(resolveLlm(undefined, "DRAFT")).toMatchObject({ key: "shared-key", model: "shared-model" });
    process.env.MISSION_API_KEY = "mission-key";
    process.env.MISSION_BASE_URL = "https://mission.example.com/v1";
    process.env.MISSION_MODEL = "minimax/minimax-m3";
    // the mission lane's reasoning model is never borrowed for a draft the founder waits on
    expect(resolveLlm(undefined, "DRAFT")?.model).toBe("shared-model");
  });
});

/**
 * REPORT groups what people found into the builder's findings. It resolves like every other lane,
 * and it is background work: the first to stop under the day's budget, never ahead of a judgment.
 */
describe("the REPORT lane", () => {
  it("is a lane, and inherits the shared chain until all three of its settings are present", () => {
    expect(LANES).toContain("REPORT");
    expect(laneProvider("REPORT")).toBeNull();
    expect(resolveLlm(undefined, "REPORT")).toMatchObject({ key: "shared-key", model: "shared-model" });
    process.env.REPORT_API_KEY = "report-key";
    process.env.REPORT_MODEL = "small-model";
    expect(laneProvider("REPORT")).toBeNull(); // two of three is absent, never spliced
    expect(resolveLlm(undefined, "REPORT")?.key).toBe("shared-key");
    process.env.REPORT_BASE_URL = "https://report.example.com/v1/";
    expect(resolveLlm(undefined, "REPORT")).toMatchObject({ key: "report-key", model: "small-model", endpoint: "https://report.example.com/v1/chat/completions" });
    // its own provider is its own: no other lane borrows it
    expect(resolveLlm(undefined, "PAYOUT")?.key).toBe("shared-key");
  });

  it("waits as background work, so it is the first to stop under the daily budget", () => {
    expect(priorityForLane("REPORT")).toBe("background");
    expect(CEILING.background).toBeLessThan(CEILING.interactive);
    expect(CEILING.background).toBeLessThan(CEILING.judgment);
  });

  it("only ever reaches a model through llmCompleteJson on its lane", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/report/index.ts"), "utf8");
    expect(src).toContain('lane: "REPORT"');
    for (const f of ["index.ts", "core.ts", "keep-posted.ts"]) {
      expect(readFileSync(join(process.cwd(), "src/lib/report", f), "utf8")).not.toMatch(/\bfetch\(/);
    }
  });
});
