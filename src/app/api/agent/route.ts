import { NextResponse, after } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAgentRef } from "@/lib/auth/agent-session";
import { mintAgentRequestId } from "@/lib/launch/planning-request";
import { loadChatMessages, saveChatMessages } from "@/lib/db/concierge-chats";
import {
  runConciergeWeb,
  conciergeEnabled,
  type AgentPageContext,
} from "@/lib/telegram/concierge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent — Agent Mode on the web (P25).
 *
 * The SAME agent as the Telegram bot, a second doorframe: one turn of the concierge, mounted read-only
 * (no money tools exist on this surface). The browser waits for the reply, so this answers synchronously
 * and defers the real inspection pipeline to `after()`.
 *
 * IDENTITY: the clientRef is resolved SERVER-SIDE (the SIWE wallet when connected, else a signed anon
 * cookie) — the client never supplies it, so a caller can't borrow another session's namespace, forge a
 * founder binding, or dodge the caps. The model never sees or sets its own ref.
 *
 * LIMITS: a per-minute burst cap + a per-session daily turn cap, both keyed by the resolved ref. The
 * concierge's own per-session inspection cap still applies inside the turn.
 */

const MAX_TEXT = 2000;
const ID_RE = /^[A-Za-z0-9_:.-]{1,100}$/;
const KINDS = new Set(["campaign", "inspection", "submission", "proof"]);

/** Accept page context ONLY in the exact shape the overlay sends; anything off → dropped (never fail the
 *  turn over it). The label stays untrusted — the concierge wraps it as data, never as an instruction. */
function parsePageContext(raw: unknown): AgentPageContext | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const id = r.id;
  if (typeof kind !== "string" || !KINDS.has(kind)) return undefined;
  if (typeof id !== "string" || !ID_RE.test(id.trim())) return undefined;
  const label = typeof r.label === "string" ? r.label.slice(0, 120) : undefined;
  return { kind: kind as AgentPageContext["kind"], id: id.trim(), label };
}

export async function POST(req: Request): Promise<Response> {
  const ref = await resolveAgentRef();

  // Per-minute burst, then per-session daily cap. The daily cap answers as a normal agent message
  // (200) so the overlay just shows it inline; the burst cap is a transient 429.
  if (!rateLimit("agentWeb", ref).ok) {
    return NextResponse.json(
      { ok: false, error: "You're going a bit fast — give me a second." },
      { status: 429 },
    );
  }
  if (!rateLimit("agentWebDaily", ref).ok) {
    return NextResponse.json({
      ok: true,
      reply:
        "You've reached today's limit with me here on the web. It resets within a day — or continue in Telegram with @sagedeputybot, which has no such limit.",
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty message" }, { status: 400 });
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json(
      { ok: false, error: "That message is too long — try a shorter one." },
      { status: 400 },
    );
  }
  const pageContext = parsePageContext(b.pageContext);

  if (!conciergeEnabled()) {
    return NextResponse.json({
      ok: true,
      reply: "My brain isn't switched on yet (no model key configured).",
    });
  }

  // Run one turn; the reply is synchronous. Any background work the turn scheduled (the real inspection
  // pipeline) runs AFTER we respond — the overlay reflects it by polling sage_get_inspection on ask.
  const jobs: Array<() => void | Promise<void>> = [];
  // A fresh request id per web turn (server-minted, never client/LLM). A tool-retry within the turn
  // reuses it (idempotent); the next message is a new turn.
  const reply = await runConciergeWeb(ref, text, (fn) => jobs.push(fn), mintAgentRequestId(), pageContext);
  if (jobs.length) {
    after(async () => {
      for (const job of jobs) {
        try {
          await job();
        } catch (err) {
          console.error("[agent] deferred job failed:", err);
        }
      }
    });
  }

  return NextResponse.json({ ok: true, reply });
}

/**
 * GET /api/agent — this session's persisted conversation, so the web chat survives reloads/visits.
 * The concierge already stores a trimmed per-ref history; we resolve the ref server-side and return
 * only the clean user/assistant turns (no tool scaffolding, no system prompt).
 */
export async function GET(): Promise<Response> {
  const ref = await resolveAgentRef();
  const founder = ref.startsWith("wallet:"); // a connected SIWE founder → knows their own campaigns
  const messages: Array<{ role: "user" | "agent"; content: string }> = [];
  try {
    const parsed: unknown = JSON.parse(loadChatMessages(ref));
    if (Array.isArray(parsed)) {
      for (const m of parsed) {
        if (!m || typeof m !== "object") continue;
        const role = (m as { role?: unknown }).role;
        const content = (m as { content?: unknown }).content;
        if (typeof content !== "string" || !content) continue;
        if (role === "user") messages.push({ role: "user", content });
        else if (role === "assistant") messages.push({ role: "agent", content });
      }
    }
  } catch {
    /* no/broken history → empty */
  }
  return NextResponse.json({ ok: true, founder, messages });
}

/** DELETE /api/agent — start a fresh chat: clear this session's persisted history. */
export async function DELETE(): Promise<Response> {
  const ref = await resolveAgentRef();
  saveChatMessages(ref, "[]");
  return NextResponse.json({ ok: true });
}
