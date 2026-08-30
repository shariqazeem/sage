import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PLAN MUST MATCH WHAT THE FOUNDER SAID.
 *
 * Every money gate in this product checks the plan against ITSELF, and a plan that quietly drops
 * two of three tranches passes all of them: $20 x 1 === $20 is a consistent budget. It is simply
 * not the budget the founder asked for, and the first anyone learns of it is when the second
 * recipient finishes work there is no milestone to pay.
 *
 * MEASURED by P-DIRECT on the flagship grant fixture: "fund my cousin's shop $60 in three
 * milestones: $20 ..., $20 ..., $20 ..." was sometimes compiled as ONE milestone worth $20.
 *
 * These hold the loop-level half of the fix: the contradiction is caught before the rows are
 * written, handed back once, and — critically — never allowed to become a wall.
 */

const h = vi.hoisted(() => ({
  callSageTool: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true, planUrl: "https://sagepays.xyz/launch/x", totalBudgetUsd: 60 }) }],
    isError: false,
  })),
  store: new Map<string, string>(),
}));

vi.mock("@/lib/mcp/server", () => ({
  MCP_TOOLS: [{ name: "sage_create_direct_campaign", description: "d", inputSchema: { type: "object", properties: {} } }],
  callSageTool: (...a: unknown[]) => h.callSageTool(...(a as [string, Record<string, unknown>])),
}));
vi.mock("@/lib/telegram/agent-wallet-tools", () => ({
  AGENT_WALLET_TOOLS: [],
  isAgentWalletTool: () => false,
  callAgentWalletTool: vi.fn(),
}));
vi.mock("@/lib/telegram/bot", () => ({
  sendTelegram: vi.fn(async () => {}),
  sendTelegramForEdit: vi.fn(async () => null),
  editTelegram: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/agent-wallets", () => ({ getAgentWallet: () => null }));
vi.mock("@/lib/privy/client", () => ({ privyConfigured: () => false }));
vi.mock("@/lib/agent-api/operations", () => ({ opGetInspection: vi.fn(() => ({ ok: false })) }));
vi.mock("@/lib/db/concierge-chats", () => ({
  loadChatMessages: (id: string) => h.store.get(id) ?? "[]",
  saveChatMessages: (id: string, v: string) => void h.store.set(id, v),
}));

import { runConcierge } from "./concierge";

const UTTERANCE =
  "fund my cousin's shop $60 in three milestones: $20 when the shop page is published, $20 when the first product is listed, $20 when the first sale is announced";

const milestone = (rewardUsd: number, i: number) => ({
  title: `Milestone ${i + 1} for the shop`,
  instructions: "Do the thing and publish the link.",
  criteria: ["The page shows the work"],
  evidence: { kind: "public_url", expectedText: ["shop"] },
  rewardUsd,
  slots: 1,
});

const toolCall = (n: number) =>
  new Response(
    JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{
            id: `tc${n}`,
            type: "function",
            function: {
              name: "sage_create_direct_campaign",
              arguments: JSON.stringify({
                kind: "grant",
                title: "Cousin's shop grant",
                milestones: Array.from({ length: n }, (_, i) => milestone(20, i)),
              }),
            },
          }],
        },
      }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const answer = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

type SentMessages = { messages: { role: string; content?: string }[] };

/** The request body of the i-th recorded fetch (negative i counts from the end). */
const bodyOf = (calls: unknown[], i: number): SentMessages => {
  const call = (calls as [unknown, { body: string }][]).at(i);
  if (!call) throw new Error(`no fetch call at ${i}`);
  return JSON.parse(String(call[1].body)) as SentMessages;
};

/**
 * How many corrections the loop actually issued.
 *
 * Counted in the LAST request's history, not summed across requests: a correction stays in the
 * message list for every later round, so summing per-request counts a single correction once per
 * round that followed it — which reads exactly like a loop that corrected twice.
 */
const correctionsIssued = (fetchMock: ReturnType<typeof vi.fn>): number =>
  bodyOf(fetchMock.mock.calls, -1).messages.filter(
    (m) => m.role === "tool" && (m.content ?? "").includes("does not match what the founder said"),
  ).length;

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

describe("a plan that contradicts the founder's numbers", () => {
  it("is refused before any row is written, and the corrected plan goes through", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return toolCall(1); // the measured defect: one $20 milestone for a $60 ask
      if (call === 2) return toolCall(3); // rebuilt from the founder's words
      return answer("Your grant is drafted: three milestones, $60 total.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const reply = await runConcierge("chat-terms-1", UTTERANCE, () => {}, "prid:test");

    // The wrong plan never reached the tool layer; only the corrected one did.
    expect(h.callSageTool).toHaveBeenCalledTimes(1);
    const args = h.callSageTool.mock.calls[0]![1] as { milestones: unknown[] };
    expect(args.milestones).toHaveLength(3);
    expect(reply).toMatch(/\$60/);
  });

  it("hands the correction back naming BOTH of the founder's numbers", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return toolCall(1);
      if (call === 2) return toolCall(3);
      return answer("Drafted.");
    });
    vi.stubGlobal("fetch", fetchMock);
    await runConcierge("chat-terms-2", UTTERANCE, () => {}, "prid:test");

    const correction = bodyOf(fetchMock.mock.calls, 1).messages.find((m) => m.role === "tool")?.content ?? "";
    expect(correction).toMatch(/3 milestones and this plan has 1/);
    expect(correction).toMatch(/add up to 60 and this plan totals 20/);
    // It must never suggest an amount of its own — only restate theirs.
    expect(correction).toMatch(/Do not invent a number/);
  });

  it("is ONE shot: a model that insists is allowed through, so a parse it cannot handle costs a round trip, not the campaign", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call <= 2) return toolCall(1); // insists on the same plan
      return answer("Drafted as you described.");
    });
    vi.stubGlobal("fetch", fetchMock);

    await runConcierge("chat-terms-3", UTTERANCE, () => {}, "prid:test");

    expect(h.callSageTool).toHaveBeenCalledTimes(1);
    const args = h.callSageTool.mock.calls[0]![1] as { milestones: unknown[] };
    expect(args.milestones).toHaveLength(1); // let through, not blocked forever
    expect(correctionsIssued(fetchMock)).toBe(1); // corrected exactly once
  });

  it("stays out of the way when the plan matches", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return toolCall(3);
      return answer("Drafted.");
    });
    vi.stubGlobal("fetch", fetchMock);
    await runConcierge("chat-terms-4", UTTERANCE, () => {}, "prid:test");
    expect(h.callSageTool).toHaveBeenCalledTimes(1);
    expect(correctionsIssued(fetchMock)).toBe(0);
  });

  it("stays silent on an utterance that states no arithmetic to check", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return toolCall(1);
      return answer("Drafted.");
    });
    vi.stubGlobal("fetch", fetchMock);
    await runConcierge("chat-terms-5", "pay my designer $50 when the logo page is live", () => {}, "prid:test");
    expect(h.callSageTool).toHaveBeenCalledTimes(1);
    expect(correctionsIssued(fetchMock)).toBe(0);
  });
});
