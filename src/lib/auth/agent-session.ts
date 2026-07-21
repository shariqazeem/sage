import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSessionAddress } from "@/lib/auth/session";

/**
 * P25 — the WEB agent's clientRef. Exactly the Telegram chatId pattern: the SERVER decides the ref, the
 * client never supplies it. The ref is the SIWE session wallet when connected (so a founder's web agent
 * thread + their inspections are bound to their wallet), else a SIGNED anonymous session id issued into
 * an httpOnly cookie on first use (HMAC over SAGE_SESSION_SECRET → un-forgeable, so one visitor can't
 * borrow another's namespace or evade the per-session caps). The returned ref is used verbatim as the
 * conversation-memory key, the rate-limit key, and the forced clientRef on sage_start_inspection.
 */
const COOKIE = "sage_agent_sid";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  const s = process.env.SAGE_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SAGE_SESSION_SECRET is required in production.");
  }
  return "sage-dev-session-secret-not-for-production";
}

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("base64url");
}

/** Verify a `<id>.<sig>` token; returns the id iff the signature is valid, else null. */
function verify(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const want = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

/**
 * Resolve the web agent ref. `wallet:0x…` when a SIWE session is present, else `anon:<id>` from a signed
 * cookie (issued here on first use). NEVER trusts a client-supplied ref. The "web:" surface prefix is
 * added by the caller (the concierge rate-limit key), so the ref stays a clean namespace here.
 */
export async function resolveAgentRef(): Promise<string> {
  const addr = await getSessionAddress();
  if (addr) return `wallet:${addr.toLowerCase()}`;

  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) {
    const id = verify(existing);
    if (id) return `anon:${id}`;
  }
  const id = randomBytes(16).toString("hex");
  jar.set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
  return `anon:${id}`;
}
