import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE GATEWAY STALLS, AND A STALL MUST NOT BE THE ANSWER.
 *
 * Reported from the live bot: slash commands worked, but "my wallet balance" came back with
 * "Something glitched reaching my brain". The prod logs showed the tool SUCCEEDING —
 * `tool=sage_agent_wallet_status ok=true` with the address and balance in it — and then the turn
 * dying with a TimeoutError. Sage had the answer and failed while composing the sentence around it.
 *
 * Measured against the live gateway from the VM, same key, same model, seconds apart:
 *
 *   attempt 1 → timed out at 60s
 *   attempt 2 → 1862ms, "OK."
 *   attempt 3 → 1469ms, "OK."
 *
 * So roughly one call in three stalls while healthy ones answer in under two seconds, and there
 * was no retry: one stall was the whole turn. These tests hold the two halves of the fix — that a
 * transient failure is retried, and that a permanent one still is not.
 */

const h = vi.hoisted(() => ({
  callSageTool: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    isError: false,
  })),
  callAgentWalletTool: vi.fn(async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, linked: true, balanceUsdc: 0 }),
      },
    ],
    isError: false,
  })),
  store: new Map<string, string>(),
}));

vi.mock("@/lib/mcp/server", () => ({
  MCP_TOOLS: [
    {
      name: "sage_get_campaign",
      description: "d",
      inputSchema: { type: "object", properties: {} },
    },
  ],
  callSageTool: (...a: unknown[]) => h.callSageTool(...(a as [])),
}));
vi.mock("@/lib/telegram/agent-wallet-tools", () => ({
  AGENT_WALLET_TOOLS: [],
  isAgentWalletTool: () => false,
  callAgentWalletTool: (...a: unknown[]) => h.callAgentWalletTool(...(a as [])),
}));
vi.mock("@/lib/telegram/bot", () => ({
  sendTelegram: vi.fn(async () => {}),
  sendTelegramForEdit: vi.fn(async () => null),
  editTelegram: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/agent-wallets", () => ({ getAgentWallet: () => null }));
vi.mock("@/lib/privy/client", () => ({ privyConfigured: () => false }));
vi.mock("@/lib/agent-api/operations", () => ({
  opGetInspection: vi.fn(() => ({ ok: false })),
}));
vi.mock("@/lib/db/concierge-chats", () => ({
  loadChatMessages: (id: string) => h.store.get(id) ?? "[]",
  saveChatMessages: (id: string, v: string) => void h.store.set(id, v),
}));

import { runConcierge } from "./concierge";

/** The real thing an AbortSignal.timeout produces, so the classifier is tested on the real string. */
const timeoutError = () => {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
};

const okBody = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let calls = 0;

beforeEach(() => {
  process.env.CONCIERGE_API_KEY = "test-key";
  process.env.CONCIERGE_BASE_URL = "https://llm.test/v1";
  // Keep the backoff from genuinely sleeping the suite through its ladder.
  process.env.LLM_RETRY_MAX_WAIT_MS = "1";
  calls = 0;
  h.store.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONCIERGE_API_KEY;
  delete process.env.CONCIERGE_BASE_URL;
  delete process.env.LLM_RETRY_MAX_WAIT_MS;
});

describe("the concierge rides out a gateway stall", () => {
  it("retries a timeout and answers, instead of reporting a glitch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw timeoutError();
        return okBody("Your wallet holds 0 USDC.");
      }),
    );
    const reply = await runConcierge("chat1", "what is my wallet balance", () => {});
    expect(calls).toBe(2);
    expect(reply).toBe("Your wallet holds 0 USDC.");
    expect(reply).not.toMatch(/glitched/i);
  });

  it("survives two stalls in a row, which is the measured failure rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls <= 2) throw timeoutError();
        return okBody("Done.");
      }),
    );
    const reply = await runConcierge("chat2", "status?", () => {});
    expect(calls).toBe(3);
    expect(reply).toBe("Done.");
  });

  it("retries a 503, which used to be classified permanent", async () => {
    // It threw `llm 503`, and isTransientLlmError matches `llm_status_5xx` — so the one error most
    // worth waiting on was the one never retried.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("upstream unavailable", { status: 503 });
        return okBody("Back.");
      }),
    );
    const reply = await runConcierge("chat3", "status?", () => {});
    expect(calls).toBe(2);
    expect(reply).toBe("Back.");
  });

  it("does NOT retry a bad key — waiting cannot fix a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("unauthorized", { status: 401 });
      }),
    );
    const reply = await runConcierge("chat4", "status?", () => {});
    expect(calls).toBe(1);
    expect(reply).toMatch(/glitched|couldn't|could not/i);
  });

  it("gives up honestly rather than looping forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        throw timeoutError();
      }),
    );
    const reply = await runConcierge("chat5", "status?", () => {});
    expect(calls).toBe(3); // LLM_ATTEMPTS, not unbounded
    expect(reply).toMatch(/glitched/i);
  });
});
