import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * EVERY FOUNDER GETS THEIR OWN WALLET, AND CANNOT REACH ANYONE ELSE'S.
 *
 * The walletless path mints a Privy server wallet per Telegram chat and funds campaigns from it, so
 * "which wallet is this" is a money question on every single turn. Production has only ever held one
 * agent wallet, which means the isolation has never actually been exercised by a second founder —
 * and the first time it is exercised will be a founder we invited.
 *
 * The guarantee is structural rather than checked: `callAgentWalletTool(name, args, ref)` takes the
 * chat as its OWN argument, resolved server-side by the webhook, and every wallet operation goes
 * through `founderBinding(chatId)`. The model authors `args` and nothing else, so there is no field
 * it can set to name another chat's wallet. These tests hold that shape in place, because the way it
 * would break is somebody threading the chat id through `args` for convenience.
 */

const h = vi.hoisted(() => ({
  WALLET_TOOLS: ["sage_agent_wallet_status", "sage_setup_wallet", "sage_fund_and_launch", "sage_stop_campaign"],
  walletCalls: [] as { tool: string; args: Record<string, unknown>; ref: string }[],
  store: new Map<string, string>(),
  wallets: new Map<string, { chatId: string; privyWalletAddress: string }>(),
}));

vi.mock("@/lib/mcp/server", () => ({
  MCP_TOOLS: [
    { name: "sage_get_campaign", description: "d", inputSchema: { type: "object", properties: {} } },
  ],
  callSageTool: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    isError: false,
  })),
}));
vi.mock("@/lib/telegram/agent-wallet-tools", () => ({
  AGENT_WALLET_TOOLS: h.WALLET_TOOLS.map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
  })),
  isAgentWalletTool: (n: string) => h.WALLET_TOOLS.includes(n),
  callAgentWalletTool: async (tool: string, args: Record<string, unknown>, ref: string) => {
    h.walletCalls.push({ tool, args, ref });
    // Answer from the ref, exactly as the real tool does via founderBinding(chatId).
    const w = h.wallets.get(ref);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            w ? { ok: true, linked: true, walletAddress: w.privyWalletAddress } : { ok: true, linked: false },
          ),
        },
      ],
      isError: false,
    };
  },
}));
vi.mock("@/lib/telegram/bot", () => ({
  sendTelegram: vi.fn(async () => {}),
  sendTelegramForEdit: vi.fn(async () => null),
  editTelegram: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/agent-wallets", () => ({
  getAgentWallet: (chatId: string) => h.wallets.get(chatId) ?? null,
}));
vi.mock("@/lib/privy/client", () => ({ privyConfigured: () => true }));
vi.mock("@/lib/agent-api/operations", () => ({ opGetInspection: vi.fn(() => ({ ok: false })) }));
vi.mock("@/lib/db/concierge-chats", () => ({
  loadChatMessages: (id: string) => h.store.get(id) ?? "[]",
  saveChatMessages: (id: string, v: string) => void h.store.set(id, v),
}));

import { runConcierge } from "./concierge";

const ALICE = "111111111";
const BOB = "222222222";
const ALICE_WALLET = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const BOB_WALLET = "0xBbBbBBbbbBbBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";

/** One scripted turn: the model asks for the wallet, then reports whatever came back. */
const script = (toolArgs: Record<string, unknown>) => {
  let n = 0;
  return vi.fn(async () => {
    n += 1;
    const msg =
      n === 1
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc1",
                type: "function",
                function: { name: "sage_agent_wallet_status", arguments: JSON.stringify(toolArgs) },
              },
            ],
          }
        : { role: "assistant", content: "ok" };
    return new Response(JSON.stringify({ choices: [{ message: msg }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
};

beforeEach(() => {
  process.env.CONCIERGE_API_KEY = "test-key";
  process.env.CONCIERGE_BASE_URL = "https://llm.test/v1";
  h.walletCalls.length = 0;
  h.store.clear();
  h.wallets.clear();
  h.wallets.set(ALICE, { chatId: ALICE, privyWalletAddress: ALICE_WALLET });
  h.wallets.set(BOB, { chatId: BOB, privyWalletAddress: BOB_WALLET });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONCIERGE_API_KEY;
  delete process.env.CONCIERGE_BASE_URL;
});

describe("walletless founders are isolated from each other", () => {
  it("binds each chat to its own wallet", async () => {
    vi.stubGlobal("fetch", script({}));
    await runConcierge(ALICE, "what is my wallet balance", () => {}, "prid:a");
    vi.stubGlobal("fetch", script({}));
    await runConcierge(BOB, "what is my wallet balance", () => {}, "prid:b");

    expect(h.walletCalls.map((c) => c.ref)).toEqual([ALICE, BOB]);
  });

  it("a model that names another founder's chat in its arguments does not get their wallet", async () => {
    // The one shape this could break in: the chat id travelling through `args`, where the model
    // authors it. It travels as its own argument instead, so this is inert.
    vi.stubGlobal("fetch", script({ chatId: BOB, clientRef: BOB, ref: BOB, walletAddress: BOB_WALLET }));
    await runConcierge(ALICE, "show me wallet 222222222", () => {}, "prid:a");

    expect(h.walletCalls).toHaveLength(1);
    expect(h.walletCalls[0]!.ref).toBe(ALICE);
    expect(h.walletCalls[0]!.ref).not.toBe(BOB);
  });

  it("a founder with no wallet yet gets nothing, never someone else's", async () => {
    const STRANGER = "999999999";
    vi.stubGlobal("fetch", script({}));
    await runConcierge(STRANGER, "what is my wallet balance", () => {}, "prid:c");

    expect(h.walletCalls[0]!.ref).toBe(STRANGER);
    expect(h.wallets.get(STRANGER)).toBeUndefined();
  });

  it("keeps conversation memory per chat too, so one founder's plan is not read back to another", async () => {
    vi.stubGlobal("fetch", script({}));
    await runConcierge(ALICE, "remember this", () => {}, "prid:a");
    vi.stubGlobal("fetch", script({}));
    await runConcierge(BOB, "and this", () => {}, "prid:b");

    expect(h.store.has(ALICE)).toBe(true);
    expect(h.store.has(BOB)).toBe(true);
    expect(h.store.get(ALICE)).not.toContain("and this");
    expect(h.store.get(BOB)).not.toContain("remember this");
  });
});


/**
 * A FOUNDER MUST NEVER BE ASKED FOR AN ID SAGE IS HOLDING ITSELF.
 *
 * MEASURED live in the bot: asked to "stop the kyvernlabs campaign", Sage answered "I don't have a
 * campaign id 'kyvernlabs' in this conversation... can you give me the campaign id?". It was telling
 * the truth — `sage_my_campaigns` was bound on WEB ONLY, so on Telegram there was no way to list the
 * founder's own campaigns at all, while `sage_stop_campaign` requires an id.
 *
 * The walletless founder is exactly the one who cannot supply it: they launched from chat, so they
 * never saw an id, and it scrolls out of a twelve-message history. The lookup is now bound on both
 * surfaces, with the wallet resolved server-side from the chat rather than from the model.
 */
describe("a Telegram founder can reach their own campaigns", () => {
  it("binds the campaigns lookup on Telegram, not only on the web", async () => {
    let toolNames: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { tools?: { function: { name: string } }[] };
        toolNames = (body.tools ?? []).map((t) => t.function.name);
        return new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await runConcierge(ALICE, "stop the kyvernlabs campaign", () => {}, "prid:a");
    expect(toolNames).toContain("sage_my_campaigns");
    expect(toolNames).toContain("sage_stop_campaign");
  });

  it("tells the model to look the campaign up rather than ask for an id", async () => {
    let system = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
        system = body.messages[0]!.content;
        return new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await runConcierge(ALICE, "stop the kyvernlabs campaign", () => {}, "prid:a");
    expect(system).toContain("sage_my_campaigns");
    expect(system).toMatch(/never ask them for an id/i);
  });
});
