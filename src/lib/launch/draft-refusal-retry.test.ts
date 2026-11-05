import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm/complete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/complete")>()),
  llmConfigured: () => true,
  llmCompleteJson: vi.fn(),
  fallbackLlm: vi.fn(() => null),
}));

import { draftDirectCampaign, WRITER_REFUSED } from "./gig-draft";
import { fallbackLlm, llmCompleteJson } from "@/lib/llm/complete";

/**
 * A SAFETY REFUSAL IS OFTEN CHANCE (6 Nov 2026). Sage Bench r9: a paid pentest of the founder's own staging was
 * refused once and drafted 6/6 when asked again. And with the fallback account empty, the founder was told
 * "Sage's writer is offline" about a writer that had simply declined once.
 */
const GOOD = {
  kind: "gig",
  title: "Rotate API keys safely: a guide",
  who: "anyone",
  slots: 1,
  milestones: [
    {
      title: "Write the key-rotation guide",
      deliverable: "A public guide to rotating API keys is published",
      instructions: "1. Write the guide.\n2. Publish it on your blog with your wallet address at the end.\n3. Submit the link.",
      criteria: ["It covers zero-downtime rotation", "It names the two-key overlap", "It is at least 600 words"],
      evidence: { kind: "artifact_url", allowedHosts: [], minWords: 600 },
    },
  ],
};
const ok = (json: unknown) => ({ json, model: "m", provider: "p", latencyMs: 1, promptTokens: 0, completionTokens: 0 }) as never;
const INTENT = { intent: "Write a 600-word guide to rotating API keys safely for our developer docs." };

afterEach(() => vi.clearAllMocks());

describe("a refusal from the writer", () => {
  it("gets one more try from the same writer before anyone else", async () => {
    vi.mocked(llmCompleteJson).mockRejectedValueOnce(new Error("llm_refused")).mockResolvedValueOnce(ok(GOOD));
    const r = await draftDirectCampaign(INTENT);
    expect(r.ok).toBe(true);
    expect(vi.mocked(llmCompleteJson).mock.calls.length).toBe(2);
  });

  it("refused twice with an empty fallback account reads as a refusal, never as 'offline'", async () => {
    vi.mocked(fallbackLlm).mockReturnValue({ endpoint: "https://fb.test/v1/chat/completions", key: "k", model: "fb", host: "fb.test" });
    vi.mocked(llmCompleteJson)
      .mockRejectedValueOnce(new Error("llm_refused"))
      .mockRejectedValueOnce(new Error("llm_refused"))
      .mockRejectedValueOnce(new Error("llm_status_402: status_402 out of credit"));
    const r = await draftDirectCampaign(INTENT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.declined && r.error).toBe(WRITER_REFUSED);
  });
});
