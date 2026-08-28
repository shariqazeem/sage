import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm/complete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/complete")>()),
  llmConfigured: () => true,
  llmCompleteJson: vi.fn(),
}));

import { runMissionBrain } from "./mission-brain";
import { llmCompleteJson } from "@/lib/llm/complete";
import type { ProductMapV1 } from "./schemas";

/**
 * A TIMEOUT IS NOT FIXABLE BY ASKING THE SAME THING AGAIN.
 *
 * The ladder answers a shape failure with temperature and a truncation with more room, but had no
 * answer for an ABORT — so it re-issued the identical request four more times. MEASURED on
 * app.uniswap.org: the legacy architect aborted at the 180s provider timeout and burned ~900s
 * repeating itself, turning a 2138s inspection into a founder waiting 35 minutes, while the plan
 * that actually shipped came from the grounded path and had finished in 9.4s.
 */
const abort = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

const minimalMap = () =>
  ({
    productName: "P", category: "app", valueProp: "v", targetUserHypotheses: [], founderTargetUsers: "u",
    primaryJourney: [], routes: [], interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [],
    repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [], pagesInspected: 2,
    repoFilesInspected: 0, digest: "0x00",
    fieldTest: { ran: true, startUrl: "https://p.test/", mode: "static", pages: [{ url: "https://p.test/", title: "P", h1: "P", ctas: ["Start"], consoleErrors: [], brokenRequests: [], jsOnly: false, visibleTextExcerpt: "Welcome to P" }], states: [], classification: null, limitation: null, durationMs: 1 },
  }) as unknown as ProductMapV1;

const input = { productUrl: "https://p.test/", goal: "explore", targetUsers: "u", totalBudgetBase: BigInt(2_000_000), tokenDecimals: 6 };

afterEach(() => { vi.clearAllMocks(); delete process.env.MISSION_GROUNDING_MODE; });

describe("the architect ladder stops re-issuing a request that times out", () => {
  it("gives up after 2 aborts instead of burning all 5 attempts", async () => {
    vi.mocked(llmCompleteJson).mockRejectedValue(abort());
    const r = await runMissionBrain(minimalMap(), input, { inspectedUrls: ["https://p.test/"] } as never, "welcome to p start");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("provider_timeout");
    // 5 attempts would be the old behaviour; 2 is the evidence that the input does not fit.
    expect(vi.mocked(llmCompleteJson).mock.calls.length).toBeLessThanOrEqual(2);
  }, 30_000);

  /** A single transient blip must still get its second chance — the cap is 2, not 1. */
  it("still retries once, so one blip does not lose the plan", async () => {
    vi.mocked(llmCompleteJson).mockRejectedValueOnce(abort());
    vi.mocked(llmCompleteJson).mockResolvedValue({
      json: { missions: [] }, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0,
    } as never);
    await runMissionBrain(minimalMap(), input, { inspectedUrls: ["https://p.test/"] } as never, "welcome to p start");
    expect(vi.mocked(llmCompleteJson).mock.calls.length).toBeGreaterThan(1);
  }, 30_000);
});
