import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { getInspectionJob } from "@/lib/db/inspection";
import { founderStorageKey, normalizeFounder, sameFounder } from "@/lib/auth/founder";
import { nowSeconds } from "@/lib/db/keys";

/**
 * A TEST PLANNED IN TELEGRAM, PAID ON THE WEB (relaunch, 20 Nov 2026).
 *
 * A chat with no wallet plans a test under the chat's own namespace (`clawup:<ref>`, see
 * `opStartInspection`), so no wallet owns it and the web's ordinary claim (which moves a plan only from
 * "anonymous") would refuse the builder their own test. When the chat hands the launch to the web
 * (`TELEGRAM_LAUNCH_ON_WEB`), its link carries a claim code: an HMAC over the plan, its owner and an
 * expiry, signed with the session secret. The chat is private, so only that builder holds the code;
 * whoever signs in on the web with it takes the plan, once, by an atomic move from that exact owner.
 * Without `SAGE_SESSION_SECRET` no code is minted, and the link says to plan the test on the web instead.
 */
export const HANDOVER_TTL_SEC = 48 * 3600;
const PREFIX = "clawup:";

function secret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.SAGE_SESSION_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

function mac(key: string, inspectionId: string, owner: string, expires: number): string {
  return createHmac("sha256", key).update(`handover|${inspectionId}|${owner}|${expires}`).digest("hex").slice(0, 40);
}

/** Only a plan a chat started without a wallet is handed over this way. */
export function handedOverOwner(owner: string): boolean {
  return owner.startsWith(PREFIX);
}

/** The claim code for this plan, or null when there is no secret to sign it with. */
export function handoverClaimCode(inspectionId: string, owner: string, nowSec = nowSeconds(), env: Record<string, string | undefined> = process.env): string | null {
  const key = secret(env);
  if (!key || !handedOverOwner(owner)) return null;
  const expires = nowSec + HANDOVER_TTL_SEC;
  return `${expires}.${mac(key, inspectionId, owner, expires)}`;
}

/** Whether this code was minted for this plan and this owner, and has not expired. */
export function handoverCodeValid(inspectionId: string, owner: string, code: unknown, nowSec = nowSeconds(), env: Record<string, string | undefined> = process.env): boolean {
  const key = secret(env);
  if (!key || typeof code !== "string" || !handedOverOwner(owner)) return false;
  const m = /^(\d{9,12})\.([0-9a-f]{40})$/.exec(code.trim());
  if (!m) return false;
  const expires = Number(m[1]);
  if (!Number.isSafeInteger(expires) || expires < nowSec) return false;
  const want = Buffer.from(mac(key, inspectionId, owner, expires), "hex");
  const got = Buffer.from(m[2], "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

export type HandoverClaim = { ok: true } | { ok: false; reason: "no_such_job" | "not_handed_over" | "bad_code" | "bad_wallet" | "already_claimed" };

/**
 * Move a handed-over plan from the chat's namespace to the signed-in wallet. Atomic on the current
 * owner, so two claims can't both win; repeating a claim that already succeeded for this wallet is ok.
 */
export function claimHandedOver(inspectionId: string, code: unknown, wallet: string, nowSec = nowSeconds()): HandoverClaim {
  const job = getInspectionJob(inspectionId);
  if (!job) return { ok: false, reason: "no_such_job" };
  if (normalizeFounder(wallet) === null) return { ok: false, reason: "bad_wallet" };
  if (sameFounder(job.founderWallet, wallet)) return { ok: true };
  if (!handedOverOwner(job.founderWallet)) return { ok: false, reason: "not_handed_over" };
  if (!handoverCodeValid(inspectionId, job.founderWallet, code, nowSec)) return { ok: false, reason: "bad_code" };
  const res = db
    .update(inspectionJobs)
    .set({ founderWallet: founderStorageKey(wallet), updatedAt: nowSec })
    .where(and(eq(inspectionJobs.id, inspectionId), eq(inspectionJobs.founderWallet, job.founderWallet)))
    .run();
  return (res.changes ?? 0) > 0 ? { ok: true } : { ok: false, reason: "already_claimed" };
}
