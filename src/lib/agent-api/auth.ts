import "server-only";

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export type AgentAuthOk = { ok: true; agentBucket: string };
export type AgentAuthErr = { ok: false; res: NextResponse };

/** Constant-time compare that does not early-return on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing ~constant, then fail
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Authenticate an inbound Sage Agent API request (the ClawUp agent). Fails CLOSED: if
 * `SAGE_AGENT_API_KEY` is unset the whole surface is "not configured" (404) — never open.
 * A valid Bearer key is rate-limited per agent (bucketed by a non-reversible hash of the
 * key, never the key itself). This surface is READ + inspection-start ONLY: it can never
 * sign, settle, move funds, or accept a private key.
 */
export function authenticateAgent(req: Request): AgentAuthOk | AgentAuthErr {
  const key = getEnv().SAGE_AGENT_API_KEY;
  if (!key) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: "Agent API is not configured." }, { status: 404 }),
    };
  }
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = m?.[1]?.trim() ?? "";
  if (!provided || !safeEqual(provided, key)) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 }),
    };
  }
  const bucket = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const rl = rateLimit("agent", bucket);
  if (!rl.ok) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 }),
    };
  }
  return { ok: true, agentBucket: bucket };
}

export function agentError(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}
