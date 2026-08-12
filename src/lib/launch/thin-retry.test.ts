import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./inspect", () => ({ inspectProduct: vi.fn(), rankPrimaryLinks: vi.fn(() => []) }));
vi.mock("./field-test", () => ({ fieldTestEnabled: vi.fn(() => true), runFieldTest: vi.fn() }));
vi.mock("./github", () => ({ inspectRepo: vi.fn(async () => ({ artifacts: [], reason: null })) }));
vi.mock("./mission-brain", () => ({ runMissionBrain: vi.fn() }));

import { inspectAndPlan, thinFieldRun, fieldRichness } from "./pipeline";
import { inspectProduct } from "./inspect";
import { runFieldTest } from "./field-test";
import { runMissionBrain } from "./mission-brain";
import type { FieldTestState, FieldTestSummary, ProductObservation, CandidateMission } from "./schemas";

/**
 * ONE MORE LOOK BEFORE ASKING THE FOUNDER.
 *
 * Browsing is a lottery: production has yielded 0 to 36 states from the same url on different runs,
 * and allbirds.com measured 13 states in one run and 0 the next hour. A thin inspection is also what
 * makes Sage interrogate the founder — "could only reach the entry screen" (15) and "no obvious
 * signup surface" (15) are the two biggest of the last fortnight's 70 needs_input results, and both
 * fire precisely when everything yielded at most one page. So a thin run now gets ONE retry, and the
 * richer of the two looks wins.
 *
 * The bounds are the point, and each has a test: never a second retry, never when the first look was
 * rich, never when the static crawl already saw plenty, and never trading a good first look for a
 * worse second one.
 */

const obs = (url: string): ProductObservation => ({
  url, status: 200, title: "Yara", headings: ["Welcome"], claims: [], ctas: ["Start"], forms: [], links: [],
  authBoundary: false, techHints: [], states: [], landmarks: [], snippets: ["Welcome. Press start."], inspectedAt: 1, contentSha256: "a".repeat(64),
});
const stt = (over: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://yara.test/", ...over });

function summary(states: number, url = "https://yara.test/"): FieldTestSummary {
  return {
    ran: true, startUrl: url, mode: "interactive", pages: [], classification: "app", limitation: null, durationMs: 10,
    states: Array.from({ length: states }, (_, i) =>
      stt({
        trigger: i === 0 ? "initial load" : `clicked 'Next ${i}'`,
        url: i === 0 ? url : `${url}step${i}`,
        visibleTextExcerpt: `Screen number ${i} with its own words on it.`,
        notableElements: [{ tag: "button", text: `Next ${i}`, role: "button" }],
        pixelDeltaPct: i === 0 ? 0 : 40,
      }),
    ),
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
const brainResult = () => ({ ok: true, reason: null, candidates: [mission], critiques: [], accepted: [mission], reports: [], needsInputQuestions: [], model: "m", provider: "p", promptVersion: "mb-v1", latencyMs: 5 });
const input = { productUrl: "https://yara.test/", goal: "explore + talk to Yara", targetUsers: "players", totalBudgetBase: BigInt(10_000_000), tokenDecimals: 6 };

const run = () => inspectAndPlan(input, "camp1", () => {}, 1, { inspectionId: "insp1" });

beforeEach(() => {
  vi.mocked(inspectProduct).mockResolvedValue({ startUrl: "https://yara.test/", host: "yara.test", observations: [obs("https://yara.test/")], limitations: [], blocked: [] });
  vi.mocked(runMissionBrain).mockResolvedValue(brainResult() as never);
  vi.mocked(runFieldTest).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("thinFieldRun / fieldRichness (the predicate and the tiebreak)", () => {
  it("mirrors the question's own trigger: at most one state AND at most one page", () => {
    expect(thinFieldRun(null)).toBe(true);
    expect(thinFieldRun(summary(0))).toBe(true);
    expect(thinFieldRun(summary(1))).toBe(true);
    expect(thinFieldRun(summary(2))).toBe(false);
  });
  it("richness counts what was seen, and a null run saw nothing", () => {
    expect(fieldRichness(null)).toBe(0);
    expect(fieldRichness(summary(3))).toBe(3);
    expect(fieldRichness(summary(0))).toBe(0);
  });
});

describe("a thin first look earns exactly one more", () => {
  it("does not retry when the first look was rich", async () => {
    vi.mocked(runFieldTest).mockResolvedValue(summary(2));
    await run();
    expect(runFieldTest).toHaveBeenCalledTimes(1);
  });

  it("retries once when both the browser and the static crawl were thin, and the richer look wins", async () => {
    // The measured allbirds shape: nothing on the first spin, a real product on the second.
    vi.mocked(runFieldTest)
      .mockResolvedValueOnce(summary(0))
      .mockResolvedValueOnce(summary(2));
    const r = await run();
    expect(runFieldTest).toHaveBeenCalledTimes(2);
    expect((r.map?.fieldTest as FieldTestSummary | null)?.states).toHaveLength(2);
    expect(r.stage).toBe("ready");
  });

  it("keeps the first look when the second is no better", async () => {
    const first = summary(1);
    vi.mocked(runFieldTest)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(summary(0));
    const r = await run();
    expect(runFieldTest).toHaveBeenCalledTimes(2);
    expect((r.map?.fieldTest as FieldTestSummary | null)?.states).toHaveLength(1);
  });

  it("a crashed retry is quiet and costs nothing — the first look survives", async () => {
    vi.mocked(runFieldTest)
      .mockResolvedValueOnce(summary(1))
      .mockRejectedValueOnce(new Error("browser died"));
    const r = await run();
    expect(runFieldTest).toHaveBeenCalledTimes(2);
    expect((r.map?.fieldTest as FieldTestSummary | null)?.states).toHaveLength(1);
  });

  it("a crashed FIRST run is retried too — a transient browser failure is the same lottery", async () => {
    vi.mocked(runFieldTest)
      .mockRejectedValueOnce(new Error("chromium crashed"))
      .mockResolvedValueOnce(summary(2));
    const r = await run();
    expect(runFieldTest).toHaveBeenCalledTimes(2);
    expect((r.map?.fieldTest as FieldTestSummary | null)?.states).toHaveLength(2);
  });

  it("never retries when the static crawl already saw plenty — the question it prevents cannot fire there", async () => {
    vi.mocked(inspectProduct).mockResolvedValue({
      startUrl: "https://yara.test/", host: "yara.test",
      observations: [obs("https://yara.test/"), obs("https://yara.test/docs"), obs("https://yara.test/pricing")],
      limitations: [], blocked: [],
    });
    vi.mocked(runFieldTest).mockResolvedValue(summary(0));
    await run();
    expect(runFieldTest).toHaveBeenCalledTimes(1);
  });

  it("never takes a third look, even when both were thin", async () => {
    vi.mocked(runFieldTest).mockResolvedValue(summary(0));
    await run();
    expect(runFieldTest).toHaveBeenCalledTimes(2);
  });
});
