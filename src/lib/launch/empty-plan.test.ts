import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm/complete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/complete")>()),
  llmConfigured: () => true,
  llmCompleteJson: vi.fn(),
}));

import { isExplicitlyEmptyPlan, runMissionBrain } from "./mission-brain";
import { llmCompleteJson } from "@/lib/llm/complete";
import type { ProductMapV1 } from "./schemas";

/**
 * AN EMPTY PLAN IS AN ANSWER, NOT A SHAPE FAILURE (5 Nov 2026).
 *
 * P-GEN on Claude Sonnet 5.5: a one-page site, and the architect answered `{"missions":[]}` in 10
 * tokens: it found nothing it could anchor a paid mission on, which is exactly what its prompt asks
 * it to say. The ladder counted that as `schema_mismatch`, asked four more times, got the same answer,
 * and the founder's launch FAILED. It should ask them a question instead.
 */
const reply = (json: unknown) => ({ json, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }) as never;

const minimalMap = () =>
  ({
    productName: "P", category: "app", valueProp: "v", targetUserHypotheses: [], founderTargetUsers: "u",
    primaryJourney: [], routes: [], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [],
    repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 2,
    repoFilesInspected: 0, digest: "0x00",
    fieldTest: { ran: true, startUrl: "https://p.test/", mode: "static", pages: [{ url: "https://p.test/", title: "P", h1: "P", ctas: ["Start"], consoleErrors: [], brokenRequests: [], jsOnly: false, visibleTextExcerpt: "Welcome to P" }], states: [], classification: null, limitation: null, durationMs: 1 },
  }) as unknown as ProductMapV1;

const input = { productUrl: "https://p.test/", goal: "explore", targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 };
const scope = { inspectedUrls: ["https://p.test/"] } as never;

afterEach(() => vi.clearAllMocks());

describe("isExplicitlyEmptyPlan", () => {
  it("is a deliberate empty list under a mission key, or a bare []", () => {
    expect(isExplicitlyEmptyPlan([])).toBe(true);
    expect(isExplicitlyEmptyPlan({ missions: [] })).toBe(true);
    expect(isExplicitlyEmptyPlan({ plan: { missions: [] } })).toBe(true);
  });
  it("is never a missing key, an unknown shape or a plan with missions", () => {
    expect(isExplicitlyEmptyPlan({})).toBe(false);
    expect(isExplicitlyEmptyPlan({ notes: [] })).toBe(false);
    expect(isExplicitlyEmptyPlan({ missions: [{ title: "t", objective: "o" }] })).toBe(false);
    expect(isExplicitlyEmptyPlan(null)).toBe(false);
    expect(isExplicitlyEmptyPlan("[]")).toBe(false);
  });
});

describe("the architect's empty plan reaches the founder as a question", () => {
  it("two empty answers end in insufficient_observation with specific questions, after 2 calls, not 5", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValue(reply({ missions: [] }));
    const r = await runMissionBrain(minimalMap(), input, scope, "welcome to p start");
    expect(r.ok).toBe(false);
    // the pipeline maps this reason to needs_input (pipeline.ts NEEDS_INPUT), never to `failed`
    expect(r.reason).toBe("insufficient_observation");
    expect(r.needsInputQuestions.length).toBeGreaterThan(0);
    expect(vi.mocked(llmCompleteJson).mock.calls.length).toBe(2);
  }, 30_000);

  it("the second look is told the first was empty, and may still design a real mission", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValueOnce(reply({ missions: [] }));
    vi.mocked(llmCompleteJson).mockResolvedValue(reply({ missions: [] }));
    await runMissionBrain(minimalMap(), input, scope, "welcome to p start");
    const second = vi.mocked(llmCompleteJson).mock.calls[1]?.[0] as { user: string };
    expect(second.user).toMatch(/previous answer was an EMPTY plan/);
    expect(second.user).not.toMatch(/MUST be a JSON array/);
  }, 30_000);

  it("an unrecognised shape is still a shape failure, on all five attempts", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValue(reply({ notes: "I could not do it" }));
    const r = await runMissionBrain(minimalMap(), input, scope, "welcome to p start");
    expect(r.reason).toBe("schema_mismatch");
    expect(vi.mocked(llmCompleteJson).mock.calls.length).toBe(5);
  }, 60_000);
});
