import "server-only";

import { nanoid } from "nanoid";

/**
 * The Deputy's correlated log. Every autonomy run gets one `correlationId` that
 * threads through decision → gate → preflight → cas → settle → journal, so a
 * single run is greppable end-to-end. One structured JSON line per step, dev-only
 * (or forced with DEPUTY_DEBUG) — never noise in production, never a fabricated
 * step: a line is printed only where real work happens.
 */

/** A fresh correlation id for one pipeline run. */
export function newCorrelationId(): string {
  return nanoid(8);
}

function debugEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || !!process.env.DEPUTY_DEBUG;
}

/**
 * Emit one JSON line for a pipeline step. `{ tag: "deputy", cid, step, ...data }`.
 * Cheap and side-effect-free when disabled; never throws.
 */
export function agentLog(
  cid: string,
  step: string,
  data: Record<string, unknown> = {},
): void {
  if (!debugEnabled()) return;
  try {
    console.log(JSON.stringify({ tag: "deputy", cid, step, ...data }));
  } catch {
    console.log(`{"tag":"deputy","cid":"${cid}","step":"${step}"}`);
  }
}
