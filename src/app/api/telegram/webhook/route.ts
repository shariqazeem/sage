import { NextResponse, after } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { parseCommand, webhookAuthorized } from "@/lib/telegram/format";
import { buildReply, sendTelegram } from "@/lib/telegram/bot";
import { buildWalletStatus } from "@/lib/telegram/wallet-status";
import { runConcierge, conciergeEnabled } from "@/lib/telegram/concierge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook — Sage's Telegram bot endpoint.
 *
 * Authenticated by the secret Telegram echoes in the
 * `X-Telegram-Bot-Api-Secret-Token` header (set once at setWebhook time) against
 * TELEGRAM_WEBHOOK_SECRET. Unset secret → the feature is off and the route 404s
 * as if it didn't exist. A wrong/absent header → 401. A valid update always 200s
 * (even when we choose not to reply) so Telegram never retries.
 *
 * Every command is answered from PUBLIC data only — campaign stats pages and the
 * agent's grounded reputation card. Nothing session-gated is reachable here.
 */
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  if (!secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!webhookAuthorized(req.headers.get(SECRET_HEADER), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    // Malformed body — accept it so Telegram doesn't retry, but do nothing.
    return NextResponse.json({ ok: true });
  }

  const msg = extractMessage(update);
  if (!msg) return NextResponse.json({ ok: true });

  // The secret already gates who can reach us; this bounds a single chat's spam.
  if (!rateLimit("telegram", `chat:${msg.chatId}`).ok) {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(msg.chatId);
  const cmd = parseCommand(msg.text);
  console.log("[telegram] chat=%s kind=%s enabled=%s", chatId, cmd.kind, conciergeEnabled());

  // Slash commands stay the fast, deterministic, grounded path. Free-form chat goes to the
  // conversational agent (CommonStack + Sage's in-process tools) — run AFTER we 200 so Telegram
  // never waits on the model; the agent sends its own reply, then any deferred inspection runs.
  if (cmd.kind === "none" || cmd.kind === "unknown") {
    if (conciergeEnabled()) {
      after(async () => {
        // Daily per-chat cap, over the per-minute limit: a public chat can't run up an LLM bill.
        // Slash commands never reach this branch, so they stay uncapped.
        if (!rateLimit("conciergeDaily", `chat:${chatId}`).ok) {
          await sendTelegram(
            chatId,
            "You've reached today's chat limit with me — it resets within a day. Slash commands like /status and /help still work anytime.",
            { html: false },
          );
          return;
        }
        console.log("[telegram] concierge run chat=%s", chatId);
        const jobs: Array<() => void | Promise<void>> = [];
        const reply = await runConcierge(chatId, msg.text, (fn) => jobs.push(fn));
        console.log("[telegram] concierge reply chat=%s jobs=%d len=%d", chatId, jobs.length, reply.length);
        if (reply) await sendTelegram(chatId, reply, { html: false });
        for (const job of jobs) {
          try {
            await job();
          } catch (err) {
            console.error("[telegram] deferred job failed:", err);
          }
        }
      });
    }
  } else if (cmd.kind === "status" && !cmd.slug) {
    // Bare /status for a chat that owns an agent wallet → the deterministic wallet dashboard
    // (address, live balance, cap, live campaigns, recent proofs). No wallet → fall back to today's
    // usage hint. Sent PLAIN (contains a raw address + URLs) so nothing needs HTML escaping.
    const dashboard = await buildWalletStatus(chatId);
    if (dashboard) {
      await sendTelegram(chatId, dashboard, { html: false });
    } else {
      const reply = buildReply(cmd);
      if (reply) await sendTelegram(chatId, reply);
    }
  } else {
    const reply = buildReply(cmd);
    if (reply) await sendTelegram(chatId, reply);
  }
  return NextResponse.json({ ok: true });
}

interface IncomingMessage {
  chatId: number | string;
  text: string;
}

/** Pull the chat id + text from a Telegram Update (message / edit / channel post). */
function extractMessage(update: unknown): IncomingMessage | null {
  if (typeof update !== "object" || update === null) return null;
  const u = update as Record<string, unknown>;
  const m = (u.message ?? u.edited_message ?? u.channel_post) as
    | Record<string, unknown>
    | undefined;
  if (!m || typeof m !== "object") return null;
  const chat = m.chat as Record<string, unknown> | undefined;
  const chatId = chat?.id;
  const text = m.text;
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    typeof text !== "string"
  ) {
    return null;
  }
  return { chatId, text };
}
