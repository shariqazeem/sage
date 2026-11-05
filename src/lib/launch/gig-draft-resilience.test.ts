import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftDirectCampaign } from "./gig-draft";
import { resetWireMemory } from "@/lib/llm/wire";

/**
 * THE DRAFT SURVIVES ITS PROVIDER.
 *
 * The founder waits on this call. It used to fail at the first model error, so a single 503 from the
 * gateway became "Sage couldn't reach its writer". Now a transient failure is retried once inside a
 * budget a person will sit through, and an outage is routed to the fallback provider.
 */
const VARS = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_RETRY_MAX_WAIT_MS", "DRAFT_API_KEY", "DRAFT_BASE_URL", "DRAFT_MODEL", "COMMONSTACK_API_KEY"];
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;

const DRAFT = {
  kind: "gig",
  title: "Translate the onboarding guide",
  who: "a translator",
  slots: 1,
  milestones: [
    {
      title: "Spanish onboarding guide",
      deliverable: "The onboarding guide exists in Spanish on a public page.",
      instructions: "1. Translate every section. 2. Publish it on a public page and submit the link.",
      criteria: ["The page is written in Spanish", "Every section of the guide is covered", "Written in their own words, not machine-pasted"],
      evidence: { kind: "artifact_url", allowedHosts: [], minWords: 300 },
    },
  ],
};
const reply = (content: unknown) =>
  new Response(JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: {} }), { status: 200 });

beforeEach(() => {
  for (const k of VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  resetWireMemory();
  process.env.LLM_API_KEY = "primary-key";
  process.env.LLM_BASE_URL = "https://primary.example.test/v1";
  process.env.LLM_MODEL = "anthropic/claude-haiku-4-5";
  process.env.LLM_RETRY_MAX_WAIT_MS = "1";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("drafting survives a failing provider", () => {
  it("retries a transient failure once and succeeds on the same provider", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => (++calls === 1 ? new Response("upstream busy", { status: 503 }) : reply(DRAFT))) as unknown as typeof fetch;
    const r = await draftDirectCampaign({ intent: "Translate our 800-word onboarding guide into Spanish for our LatAm users." });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("routes an outage to the fallback provider instead of failing the founder", async () => {
    process.env.LLM_FALLBACK_API_KEY = "fallback-key";
    process.env.LLM_FALLBACK_BASE_URL = "https://fallback.example.test/v1";
    process.env.LLM_FALLBACK_MODEL = "deepseek/deepseek-v4-flash";
    const hosts: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      return url.includes("primary.example.test") ? new Response("down", { status: 503 }) : reply(DRAFT);
    }) as unknown as typeof fetch;
    const r = await draftDirectCampaign({ intent: "Translate our 800-word onboarding guide into Spanish for our LatAm users." });
    expect(r.ok).toBe(true);
    expect(hosts.filter((h) => h === "primary.example.test").length).toBe(2);
    expect(hosts.at(-1)).toBe("fallback.example.test");
  });

  it("still tells the founder plainly when every provider is down", async () => {
    global.fetch = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const r = await draftDirectCampaign({ intent: "Translate our 800-word onboarding guide into Spanish for our LatAm users." });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/couldn't reach its writer/) });
  });

  it("drafts on a DRAFT lane configured alone, with no shared chain", async () => {
    delete process.env.LLM_API_KEY;
    process.env.DRAFT_API_KEY = "draft-key";
    process.env.DRAFT_BASE_URL = "https://draft.example.test/v1";
    process.env.DRAFT_MODEL = "anthropic/claude-sonnet-5-5";
    global.fetch = vi.fn(async () => reply(DRAFT)) as unknown as typeof fetch;
    const r = await draftDirectCampaign({ intent: "Translate our 800-word onboarding guide into Spanish for our LatAm users." });
    expect(r.ok).toBe(true);
  });
});
