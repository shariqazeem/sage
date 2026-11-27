import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * GIVE A TEST TO ITS BUILDER (27 Nov 2026): the code itself, with no database, so it can be tested alone.
 *
 * Someone who ran Sage on another person's product (the founder reaching out to builders, say) can hand the
 * plan to that product's builder: the gift link carries a code signed with the session secret over the plan,
 * its CURRENT owner and an expiry. Binding the owner is what makes it single-use: the moment the plan moves to
 * the person who claims it, the owner changes and every copy of the link stops working. Without
 * `SAGE_SESSION_SECRET` no code is minted, the same rule as a Telegram hand-over.
 */
export const GIFT_TTL_SEC = 7 * 24 * 3600;

type Env = Record<string, string | undefined>;

function secret(env: Env): string | null {
  const s = env.SAGE_SESSION_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

function mac(key: string, inspectionId: string, owner: string, expires: number): string {
  // "gift|" keeps these codes apart from a hand-over's, which are signed with the same secret
  return createHmac("sha256", key).update(`gift|${inspectionId}|${owner.toLowerCase()}|${expires}`).digest("hex").slice(0, 40);
}

/** The gift code for this plan as its owner holds it now, or null when there is no secret to sign with. */
export function giftCode(inspectionId: string, owner: string, nowSec: number, env: Env = process.env): string | null {
  const key = secret(env);
  if (!key || !owner || owner === "anonymous") return null;
  const expires = nowSec + GIFT_TTL_SEC;
  return `${expires}.${mac(key, inspectionId, owner, expires)}`;
}

/** Whether this code was minted for this plan while this owner held it, and has not expired. */
export function giftCodeValid(inspectionId: string, owner: string, code: unknown, nowSec: number, env: Env = process.env): boolean {
  const key = secret(env);
  if (!key || typeof code !== "string" || !owner || owner === "anonymous") return false;
  const m = /^(\d{9,12})\.([0-9a-f]{40})$/.exec(code.trim());
  if (!m) return false;
  const expires = Number(m[1]);
  if (!Number.isSafeInteger(expires) || expires < nowSec) return false;
  const want = Buffer.from(mac(key, inspectionId, owner, expires), "hex");
  const got = Buffer.from(m[2], "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}
