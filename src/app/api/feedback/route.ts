import { NextResponse, type NextRequest } from "next/server";
import { recordFeedback } from "@/lib/db/feedback";
import { getEnv } from "@/lib/env";
import { sendTelegram } from "@/lib/telegram/bot";

export const runtime = "nodejs";

/**
 * POST /api/feedback — the one-textarea complaint/praise pipe.
 *
 * Anonymous-first: no auth, no required contact. Everything is bounded at this door and the row is
 * plain text forever after — feedback is DATA about the product, never instructions to anything.
 * Each accepted row also notifies the operator's Telegram immediately (best-effort; the row is the
 * source of truth, the DM is the alarm bell).
 *
 * Abuse posture: per-IP fixed-window limiter (in-memory — one prod process, same trade the other
 * public routes make) + hard length caps. Worst case an abuser fills rows the operator skims.
 */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, { n: number; resetAt: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  h.n++;
  return h.n > MAX_PER_WINDOW;
}

const asBounded = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
};

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) {
    return NextResponse.json({ ok: false, error: "Too much feedback too fast — try again in a few minutes." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  /**
   * The server is the enforcement, not the button. Feedback tied to an INSPECTION is the traceable
   * half of a paid mission, so it must carry a contact; anonymous stays right everywhere else.
   */
  const inspectionIdIn = asBounded(body.inspectionId, 64);
  const contactIn = asBounded(body.contact, 200);
  if (inspectionIdIn && (!contactIn || contactIn.length < 3)) {
    return NextResponse.json(
      { ok: false, error: "Add your Telegram, X or email so we can reach you." },
      { status: 400 },
    );
  }
  const message = asBounded(body.message, 2000);
  if (!message || message.length < 3) {
    return NextResponse.json({ ok: false, error: "Say a little more — feedback needs at least a few words." }, { status: 400 });
  }

  const row = recordFeedback({
    message,
    contact: asBounded(body.contact, 200),
    // page/inspectionId come from the widget, but they are still caller-controlled strings —
    // bounded here, rendered as text everywhere.
    page: asBounded(body.page, 200),
    inspectionId: asBounded(body.inspectionId, 40),
    surface: "web",
  });

  // The alarm bell — best-effort, never blocks the 200. Plain text: feedback is untrusted input
  // and must never be sent with HTML parsing enabled.
  const chatId = getEnv().TELEGRAM_CHAT_ID;
  if (chatId) {
    const note = [
      `Feedback (${row.id})${row.page ? ` on ${row.page}` : ""}${row.inspectionId ? ` · plan ${row.inspectionId}` : ""}:`,
      row.message,
      row.contact ? `Reply-to: ${row.contact}` : "(no contact left)",
    ].join("\n\n");
    void sendTelegram(chatId, note.slice(0, 3800), { html: false }).catch(() => false);
  }

  return NextResponse.json({ ok: true, id: row.id });
}
