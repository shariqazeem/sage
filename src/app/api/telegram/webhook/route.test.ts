import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `after` runs its work once the response is sent, and only exists inside a real request: here the work is kept
// so a test can run it. The bot's send is watched (it is a no-op anyway: no bot token is set in the suite).
const h = vi.hoisted(() => ({ deferred: [] as (() => unknown)[], sent: [] as { chatId: string; text: string }[] }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void h.deferred.push(fn) }));
vi.mock("@/lib/telegram/bot", async (orig) => {
  const real = await orig<typeof import("@/lib/telegram/bot")>();
  return { ...real, sendTelegram: async (chatId: string, text: string) => void h.sent.push({ chatId: String(chatId), text }) };
});

import { POST } from "./route";
import { buildReply } from "@/lib/telegram/bot";
import { createCampaign, recordEvent } from "@/lib/db/campaigns";

/**
 * Webhook secret rejection + command dispatch. The DB is the isolated in-memory
 * SQLite vitest configures (SAGE_DB_PATH=":memory:"), and TELEGRAM_BOT_TOKEN is
 * unset, so buildReply reads real rows while sendTelegram is a no-op — no network.
 */

const SECRET = "webhook-s3cr3t";
const HEADER = "x-telegram-bot-api-secret-token";
let savedSecret: string | undefined;

beforeEach(() => {
  h.deferred.length = 0;
  h.sent.length = 0;
  savedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = savedSecret;
});

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const update = (text: string, chatId = 55) => ({
  message: { chat: { id: chatId }, text },
});

describe("POST /api/telegram/webhook — secret rejection", () => {
  it("404s when no webhook secret is configured (feature off)", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await post(update("/agent"), { [HEADER]: SECRET });
    expect(res.status).toBe(404);
  });

  it("401s when the secret header is missing", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const res = await post(update("/agent"));
    expect(res.status).toBe(401);
  });

  it("401s when the secret header is wrong", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const res = await post(update("/agent"), { [HEADER]: "not-the-secret" });
    expect(res.status).toBe(401);
  });

  it("200s an authorized update (bot token unset → send is a no-op)", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const res = await post(update("/agent"), { [HEADER]: SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("200s non-command chatter at once, and with no model configured answers it with the plain reason and the way to the web", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const res = await post(update("can you test my app at getdrops.app?", 5601), { [HEADER]: SECRET });
    expect(res.status).toBe(200);
    // nothing is sent before the response: Telegram never waits on it
    expect(h.sent).toEqual([]);
    for (const job of h.deferred) await job();
    // it used to be silence. Now: why Sage cannot chat, and where everything still works (no model writes this)
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.chatId).toBe("5601");
    expect(h.sent[0]!.text).toMatch(/^I can't chat right now: the model I think with is not switched on here\./);
    expect(h.sent[0]!.text).toContain("Test a product: paste its link at ");
    expect(h.sent[0]!.text).toContain("/status and /help still work here.");
  });
});

describe("buildReply — public command dispatch", () => {
  it("/status reports real paid-of-max and settled totals from the journal", () => {
    const c = createCampaign({
      title: "Dispatch demo",
      rewardAmount: 500_000,
      maxRecipients: 4,
      vaultAddress: "0x0000000000000000000000000000000000000001",
      posterWallet: "0x0000000000000000000000000000000000000002",
      status: "live",
    });
    recordEvent({ campaignId: c.id, kind: "settled", amount: 500_000 });

    const reply = buildReply({ kind: "status", slug: c.id });
    expect(reply).toContain("Dispatch demo");
    expect(reply).toContain("1/4 paid · $0.50 settled");
  });

  it("hides a draft campaign from /status", () => {
    const c = createCampaign({
      title: "Secret draft",
      rewardAmount: 1_000_000,
      vaultAddress: "0x0000000000000000000000000000000000000003",
      posterWallet: "0x0000000000000000000000000000000000000004",
      status: "draft",
    });
    expect(buildReply({ kind: "status", slug: c.id })).toBe("Campaign not found.");
  });

  it("/status with no slug returns usage; /agent names the agent", () => {
    expect(buildReply({ kind: "status", slug: "" })).toContain("Usage:");
    expect(buildReply({ kind: "agent" })).toContain("Sage");
  });

  it("stays silent on non-commands and helps on unknown ones", () => {
    expect(buildReply({ kind: "none" })).toBeNull();
    expect(buildReply({ kind: "unknown" })).toContain("/status");
  });
});
