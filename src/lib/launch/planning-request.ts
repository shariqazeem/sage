import "server-only";

import { createHash, randomUUID } from "node:crypto";

/**
 * Server-authoritative `planningRequestId` — the request-scoped identity that makes
 * inspection idempotency turn-scoped instead of content-scoped. One founder INSTRUCTION
 * (one turn) receives exactly one id; a later turn with byte-identical url+goal+budget
 * receives a NEW id (and therefore a NEW job — it can never silently reuse an already-ready
 * plan). The id is minted by the trusted runtime and force-injected into the tool call
 * (mirroring `clientRef`); the LLM never authors it.
 *
 *   · Telegram — DETERMINISTIC over the trusted (actor, chat, update) triple, so a webhook
 *     redelivery of the SAME update is idempotent (same id → same job), a NEW message is a
 *     new turn, and it is ACTOR-bound: two separate actors in one group chat can never
 *     cross-bind onto each other's request.
 *   · Web / agent / api — a fresh UUID per submitted request/turn.
 *
 * The `prid:<surface>:` prefix keeps every new-schema id structurally distinct from the
 * legacy 64-hex content keys that still live in the `idempotency_key` column.
 */

const RE = /^prid:(web|agent|api|tg|test):[a-z0-9-]{8,64}$/i;

export function mintWebRequestId(): string {
  return `prid:web:${randomUUID()}`;
}
export function mintAgentRequestId(): string {
  return `prid:agent:${randomUUID()}`;
}
export function mintApiRequestId(): string {
  return `prid:api:${randomUUID()}`;
}

/** Deterministic per trusted (actor, chat, update) triple — redelivery-stable, actor-bound. */
export function mintTelegramRequestId(
  actorId: string | number | null | undefined,
  chatId: string | number,
  turnId: string | number | null | undefined,
): string {
  const h = createHash("sha256")
    .update(`tg|${String(actorId ?? "")}|${String(chatId)}|${String(turnId ?? "")}`)
    .digest("hex")
    .slice(0, 40);
  return `prid:tg:${h}`;
}

/** True only for a well-formed, runtime-minted id (defense against a client/LLM forging junk). */
export function isPlanningRequestId(v: unknown): v is string {
  return typeof v === "string" && RE.test(v);
}

/**
 * Normalize a browser-supplied launch-form request token into a server-namespaced id. The
 * client mints one UUID per form so a double-submit reuses it (one job, not two); a fresh
 * form is a fresh turn. Junk/absent → a server-minted id (a new turn, fail-safe).
 */
export function webRequestIdFrom(raw: unknown): string {
  if (typeof raw === "string" && /^[0-9a-f-]{8,64}$/i.test(raw)) return `prid:web:${raw}`;
  return mintWebRequestId();
}
