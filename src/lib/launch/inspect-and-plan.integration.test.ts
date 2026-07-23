import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * PRODUCTION-PATH integration tests — they enter through the REAL `inspectAndPlan` pipeline (the function
 * the inspection job runs), with only EXTERNAL EFFECTS substituted (the HTTP inspector, the browser field
 * test, the repo fetch, the LLM mission brain). Everything in between is real: buildProductMap →
 * deriveObservations (Eyes V2) → the replay-shadow wiring → allocateBudget → compilePlan. This proves the
 * capability is reachable from Sage's real entrypoint, not just from a standalone module test.
 */
vi.mock("./inspect", () => ({ inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("./field-test", () => ({ fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("./github", () => ({ inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("./mission-brain", () => ({ runMissionBrain: vi.fn() }));

import { inspectAndPlan } from "./pipeline";
import { inspectProduct } from "./inspect";
import { runFieldTest } from "./field-test";
import { runMissionBrain } from "./mission-brain";
import type { FieldTestState, FieldTestSummary, ProductObservation, CandidateMission } from "./schemas";

const obs = (url: string): ProductObservation => ({
  url, status: 200, title: "Yara", headings: ["Welcome"], claims: [], ctas: ["Start"], forms: [], links: [],
  authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Welcome. Press start."], inspectedAt: 1, contentSha256: "a".repeat(64),
});
const stt = (over: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://yara.test/", ...over });
function fieldTest(url = "https://yara.test/"): FieldTestSummary {
  return {
    ran: true, startUrl: url, mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10,
    states: [
      stt({ trigger: "initial load", url, visibleTextExcerpt: "Welcome. Press start.", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
      stt({ trigger: "clicked 'Start'", url: url + "play", visibleTextExcerpt: "You reach the garden world.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
    ],
  };
}
const mission: CandidateMission = {
  missionKey: "reach-world", title: "Reach the garden world", objective: "Reach the world by clicking Start",
  instructions: "1. Click Start. 2. Observe the world.", targetSurface: "https://yara.test/",
  criteria: ["Reach the garden world after clicking Start"], evidenceRequirements: ["Describe the world state you reached"],
  whyItMatters: "core journey", sources: [{ kind: "page", ref: "https://yara.test/", observation: "reached the world" }],
  priority: "high", riskCategory: "critical_journey", effortMinutes: 3, conditions: [], rewardWeight: 5, maxCompletions: 4,
  verificationMethod: "the tester's account judged against the observation corpus", confidence: 0.85, assumptions: [], disallowed: [],
};
const brainResult = () => ({ ok: true, reason: null, candidates: [mission], critiques: [], accepted: [mission], reports: [], needsInputQuestions: [], model: "google/gemini-3.1-flash-lite-preview", provider: "api.commonstack.ai", promptVersion: "mb-v1", latencyMs: 5 });
const input = { productUrl: "https://yara.test/", goal: "explore + talk to Yara", targetUsers: "players", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 };

beforeEach(() => {
  vi.mocked(inspectProduct).mockResolvedValue({ startUrl: "https://yara.test/", host: "yara.test", observations: [obs("https://yara.test/")], limitations: [], blocked: [] });
  vi.mocked(runFieldTest).mockResolvedValue(fieldTest());
  vi.mocked(runMissionBrain).mockResolvedValue(brainResult() as never);
});
afterEach(() => { delete process.env.INSPECTION_REPLAY_MODE; });

describe("live inspection pipeline — Eyes V2 reachability", () => {
  it("inspectAndPlan produces SEEN facts + transitions + a stable observationSetDigest (replay OFF → no browser)", async () => {
    const r1 = await inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });
    expect(r1.stage).toBe("ready");
    const set = r1.map!.observations!;
    expect(set.facts.some((f) => f.grounding === "seen" && f.elementName === "Start")).toBe(true);
    expect(set.transitions.length).toBeGreaterThan(0);
    expect(set.digest).toMatch(/^[0-9a-f]{24}$/);
    expect(r1.map!.replayShadow).toBeUndefined(); // mode off → the replay block is a no-op, no browser
    // observationSetDigest is stable for the same inspection input.
    const r2 = await inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });
    expect(r2.map!.observations!.digest).toBe(set.digest);
  });

  it("the digest is carried in the persisted artifact (map.digest unaffected; observations attached post-digest)", async () => {
    const r = await inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });
    // map.digest (the canonical hash) is over the static map only; observations are additive + digest-neutral.
    const withObs = r.map!.digest;
    vi.mocked(runFieldTest).mockResolvedValue({ ...fieldTest(), states: [] }); // no interactive states → no facts
    const r2 = await inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });
    expect(r2.map!.digest).toBe(withObs); // observations presence never shifts the canonical digest
  });

  it("LEGACY compatibility: an inspection with NO field test yields no observation set but still plans", async () => {
    vi.mocked(runFieldTest).mockResolvedValue({ ...fieldTest(), ran: false, states: [] });
    const r = await inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });
    expect(r.stage).toBe("ready");
    expect(r.map!.observations).toBeUndefined(); // absent, not an error
    expect(r.map!.replayShadow).toBeUndefined();
  });

  it("SHADOW mode with no reachable target records the replay honestly (no synthetic success)", async () => {
    // mode shadow + a field test whose URLs aren't the local fixture → the real replay runs from the real
    // pipeline path and records an honest non-reproduced classification (or nothing if the engine is absent).
    process.env.INSPECTION_REPLAY_MODE = "shadow";
    const r = await inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });
    expect(r.stage).toBe("ready");
    if (r.map!.replayShadow) {
      expect(r.map!.replayShadow.mode).toBe("shadow");
      // whatever happened, it is NEVER a fabricated "reproduced" against an unreachable/blocked target.
      for (const rec of r.map!.replayShadow.results) expect(rec.classification).not.toBe("reproduced");
    }
  }, 60_000);
});

/* ── one controlled REAL-BROWSER inspection through the actual pipeline entrypoint ── */
const LIVE = process.env.INSPECTION_REPLAY_TEST === "1";
let server: http.Server | null = null;
afterAll(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); });

describe.runIf(LIVE)("live inspection pipeline — REAL browser replay through inspectAndPlan", () => {
  it("shadow replay of an observed transition runs through the real pipeline against a local fixture", async () => {
    // clicking Start reveals the full observed after-state (both added texts), so the probe reproduces it.
    server = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<button id="s">Start</button><div id="o"></div><script>document.getElementById('s').onclick=()=>document.getElementById('o').textContent='You reach the garden world. Talk to Yara';</script>`); });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server!.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}/`;
    vi.mocked(runFieldTest).mockResolvedValue(fieldTest(origin));
    process.env.INSPECTION_REPLAY_MODE = "shadow";
    const r = await inspectAndPlan(input, "camp1", () => {}, 1, {
      inspectionId: "insp_live",
      replayDeps: { allowLoopback: new Set([`127.0.0.1:${port}`]), egressAllowedPorts: new Set([80, 443, port]) },
    });
    expect(r.stage).toBe("ready");
    expect(r.map!.replayShadow?.probes).toBeGreaterThan(0);
    expect(r.map!.replayShadow?.results.some((x) => x.classification === "reproduced")).toBe(true);
  }, 60_000);
});
