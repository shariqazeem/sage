import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A TRUNCATED MONOLOGUE IS NOT THE FOUNDER'S REPLY.
 *
 * The shared stripper removes one CLOSED <think> block and leaves an unclosed one alone — correct
 * for the JSON parsers, where truncated reasoning must fail loudly instead of being swallowed. On
 * the founder-facing path that same conservatism ships the monologue: nothing is stripped, the
 * text is not empty, so the honest fallback never fires and Sage's private reasoning about the
 * founder becomes the message they read.
 *
 * MEASURED on P-DIRECT: this model answers a plain gig request with reasoning and no tool call on
 * roughly one run in three ("I should call sage_create_direct_campaign", then stop). Whether that
 * block closes is up to where the token budget runs out.
 */

const h = vi.hoisted(() => ({
  callSageTool: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true, planUrl: "https://sagepays.xyz/launch/x", totalBudgetUsd: 20 }) }],
    isError: false,
  })),
  store: new Map<string, string>(),
}));

vi.mock("@/lib/mcp/server", () => ({
  MCP_TOOLS: [{ name: "sage_create_direct_campaign", description: "d", inputSchema: { type: "object", properties: {} } }],
  callSageTool: (...a: unknown[]) => h.callSageTool(...(a as [string, Record<string, unknown>])),
}));
vi.mock("@/lib/telegram/agent-wallet-tools", () => ({
  AGENT_WALLET_TOOLS: [], isAgentWalletTool: () => false, callAgentWalletTool: vi.fn(),
}));
vi.mock("@/lib/telegram/bot", () => ({
  sendTelegram: vi.fn(async () => {}), sendTelegramForEdit: vi.fn(async () => null), editTelegram: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/agent-wallets", () => ({ getAgentWallet: () => null }));
vi.mock("@/lib/privy/client", () => ({ privyConfigured: () => false }));
vi.mock("@/lib/agent-api/operations", () => ({ opGetInspection: vi.fn(() => ({ ok: false })) }));
vi.mock("@/lib/db/concierge-chats", () => ({
  loadChatMessages: (id: string) => h.store.get(id) ?? "[]",
  saveChatMessages: (id: string, v: string) => void h.store.set(id, v),
}));

import { runConcierge } from "./concierge";

const say = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });

/** The real shape: opens the block, reasons about the founder, and is cut off mid-thought. */
const TRUNCATED =
  "<think>The founder wants to pay someone $20 to translate their restaurant menu into English " +
  "and publish it as a public page. This is a direct campaign, not product testing. I should call " +
  "sage_create_direct_campaign with kind gig. Let me work out the milestone titles and the pass";

const ASK = "I need someone to translate my restaurant menu into English. $20 when they publish it as a public page.";

beforeEach(() => {
  process.env.CONCIERGE_API_KEY = "test-key";
  process.env.CONCIERGE_BASE_URL = "https://llm.test/v1";
  process.env.LLM_RETRY_MAX_WAIT_MS = "1";
  h.store.clear();
  h.callSageTool.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONCIERGE_API_KEY;
  delete process.env.CONCIERGE_BASE_URL;
  delete process.env.LLM_RETRY_MAX_WAIT_MS;
});

describe("an unclosed <think> block never reaches the founder", () => {
  it("is not shipped as the reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => say(TRUNCATED)));
    const reply = await runConcierge("chat-think-1", ASK, () => {}, "prid:test");
    expect(reply).not.toContain("<think>");
    expect(reply).not.toMatch(/I should call sage_create_direct_campaign/);
    expect(reply).toMatch(/wasn't able to finish|rephras/i);
  });

  it("gives the turn a corrective round instead of giving up on it", async () => {
    // Emptying the draft hands it to the money-action guard, which is the whole point: the founder
    // named an amount and a job, so the right recovery is to RUN the tool, not to apologise.
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) return say(TRUNCATED);
      // ONE tool call, then prose — a mock that returns the call forever makes the loop spin and
      // reads exactly like a runaway, which is a defect in the instrument, not the product.
      if (call > 2) return say("Your gig is drafted: $20 when the English menu is published.");
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", tool_calls: [{
          id: "tc1", type: "function",
          function: { name: "sage_create_direct_campaign", arguments: JSON.stringify({
            kind: "gig", title: "Translate the restaurant menu",
            milestones: [{ title: "Publish the English menu", instructions: "Translate and publish it publicly.", criteria: ["The page shows the English menu"], evidence: { kind: "public_url", expectedText: ["menu"] }, rewardUsd: 20, slots: 1 }],
          }) },
        }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const reply = await runConcierge("chat-think-2", ASK, () => {}, "prid:test");
    expect(h.callSageTool).toHaveBeenCalledTimes(1);
    expect(reply).not.toContain("<think>");
  });

  it("still strips a CLOSED block and ships what follows, unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => say("<think>weighing it up</think>Your gig is drafted.")));
    const reply = await runConcierge("chat-think-3", "what do you do?", () => {}, "prid:test");
    expect(reply).toBe("Your gig is drafted.");
  });

  it("leaves a reply that merely MENTIONS the tag alone — only a leading block is reasoning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => say("Use <think> tags to mark reasoning in your prompt.")));
    const reply = await runConcierge("chat-think-4", "how do I mark reasoning?", () => {}, "prid:test");
    expect(reply).toBe("Use <think> tags to mark reasoning in your prompt.");
  });
});
