import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("200s and stays silent on non-command chatter", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const res = await post(update("gm"), { [HEADER]: SECRET });
    expect(res.status).toBe(200);
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
