import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm/complete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/complete")>()),
  llmConfigured: () => true,
  llmCompleteJson: vi.fn(),
}));

import { runMissionBrain } from "./mission-brain";
import { llmCompleteJson } from "@/lib/llm/complete";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { NO_MODEL_PLAN, NO_MODEL_REASONS, UNREADABLE_REASONS } from "./no-model";
import type { ProductMapV1 } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/**
 * EVERY ANSWER UNREADABLE, ON THE JOB'S LAST RUN (22 Nov 2026).
 *
 * Read from every stored plan: 20 of the 62 jobs production ever failed ended with a design nobody could read
 * (a wrong shape, broken JSON, an answer cut off), one of them a real builder two days before this was written.
 * The first such run is simply run again (job.ts), and that stays. When the retry ends the same way there is
 * nothing left to try: the first-try mission alone is then the test, marked as written without a model.
 */
const reply = (json: unknown) => ({ json, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }) as never;

const map = () =>
  ({
    productName: "Kettle", category: "app", valueProp: "v", targetUserHypotheses: [], founderTargetUsers: "u",
    primaryJourney: [], routes: [], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [],
    repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 2,
    repoFilesInspected: 0, digest: "0x00",
    fieldTest: {
      ran: true, startUrl: "https://kettle.test/", mode: "static", states: [], classification: null, limitation: null, durationMs: 1,
      pages: [{ url: "https://kettle.test/", title: "Kettle", h1: "Share a pot with friends", ctas: ["Share a pot"], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null, visibleTextExcerpt: "Share a pot with friends\nPick a tea and invite the table" }],
    },
  }) as unknown as ProductMapV1;

const input = { productUrl: "https://kettle.test/", goal: "see whether strangers get it", targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 };
const scope: ValidationScope = { knownUrls: new Set(["https://kettle.test/"]), hosts: new Set(["kettle.test"]), repoPaths: new Set() };
const corpus = "kettle • share a pot with friends • share a pot • pick a tea and invite the table";

afterEach(() => vi.clearAllMocks());

describe("which reasons are unreadable answers", () => {
  it("a wrong shape, broken JSON and an answer cut off; never one of the no-model reasons, an empty plan or a gate refusal", () => {
    expect([...UNREADABLE_REASONS].sort()).toEqual(["invalid_json", "schema_mismatch", "truncated_output"]);
    for (const r of UNREADABLE_REASONS) expect(NO_MODEL_REASONS.has(r), r).toBe(false);
    for (const r of ["insufficient_observation", "no_missions_passed_validation", "no_inspected_pages"]) expect(UNREADABLE_REASONS.has(r), r).toBe(false);
  });
});

describe("a design nobody could read", () => {
  it("on a first run is still a failure, so the job is run again as before", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValue(reply({ notes: "I could not do it" }));
    const r = await runMissionBrain(map(), input, scope, corpus, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("schema_mismatch");
  }, 60_000);

  it("on the job's last run ends in the first-try mission alone, marked as written without a model", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValue(reply({ notes: "I could not do it" }));
    const r = await runMissionBrain(map(), input, scope, corpus, { lastTry: true, firstScreen: { title: "Kettle", headings: ["Share a pot with friends"], ctas: ["Share a pot"] } });
    expect(r.ok).toBe(true);
    expect(r.accepted.map((m) => m.missionKey)).toEqual([CORE_MISSION_KEY]);
    expect(r.model).toBe(NO_MODEL_PLAN);
    expect(r.withoutModel).toEqual({ reason: "schema_mismatch" });
    // the main action is read from the product's own call to action, and every anchor is text Sage read
    expect(r.accepted[0]!.instructions).toContain("try to share a pot");
    for (const a of r.accepted[0]!.anchors ?? []) expect(corpus).toContain(a.toLowerCase());
  }, 60_000);

  it("an EMPTY plan on the last run is still an answer: the builder is asked", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValue(reply({ missions: [] }));
    const r = await runMissionBrain(map(), input, scope, corpus, { lastTry: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_observation");
    expect(r.needsInputQuestions.length).toBeGreaterThan(0);
  }, 60_000);
});
