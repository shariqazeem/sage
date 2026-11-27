import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { founderStorageKey, normalizeFounder, sameFounder } from "@/lib/auth/founder";
import { nowSeconds } from "@/lib/db/keys";
import { handedOverOwner } from "@/lib/telegram/handover-claim";
import { giftCode, giftCodeValid } from "./gift-code";

export { GIFT_TTL_SEC, giftCode, giftCodeValid } from "./gift-code";

/**
 * GIVE A TEST TO ITS BUILDER (27 Nov 2026). The founder's outreach, as a product: paste someone's product, let
 * Sage try it, and send its builder a link to what a stranger hits on a first visit. The builder opens it,
 * reads Sage's first look, and takes the test with one sign-in; paying for real people stays their choice.
 *
 * WHAT A GIFT CAN BE. A plan a wallet owns (never a chat's hand-over or an X draft: those have their own doors),
 * finished (ready, or asking a question), and not yet paid for: a launched test is a live corpus, and its first
 * look is its owner's alone (NO CORPUS ORACLE, CLAUDE.md). So a forwarded gift link can show Sage's run only
 * before any place exists, and stops working the moment the plan is claimed (the owner changes) or launched.
 */
export type GiftRefusal = "no_such_job" | "not_yours" | "not_giftable" | "launched" | "no_secret";

function giftable(job: { founderWallet: string; status: string; publicCampaignId: string }): GiftRefusal | null {
  if (job.founderWallet === "anonymous" || handedOverOwner(job.founderWallet)) return "not_giftable";
  if (job.status !== "ready" && job.status !== "needs_input") return "not_giftable";
  if (getCampaign(job.publicCampaignId)) return "launched";
  return null;
}

/** The owner asks for a gift link: the code for the plan as they hold it now. */
export function makeGift(inspectionId: string, owner: string, nowSec = nowSeconds()): { ok: true; code: string; expires: number } | { ok: false; reason: GiftRefusal } {
  const job = getInspectionJob(inspectionId);
  if (!job) return { ok: false, reason: "no_such_job" };
  if (!sameFounder(job.founderWallet, owner)) return { ok: false, reason: "not_yours" };
  const refused = giftable(job);
  if (refused) return { ok: false, reason: refused };
  const code = giftCode(inspectionId, job.founderWallet, nowSec);
  if (!code) return { ok: false, reason: "no_secret" };
  return { ok: true, code, expires: Number(code.split(".")[0]) };
}

/** Whether this visitor holds a live gift for this plan: they see its first look as its owner would. */
export function holdsGift(job: { id: string; founderWallet: string; status: string; publicCampaignId: string }, code: unknown, nowSec = nowSeconds()): boolean {
  if (typeof code !== "string" || code.length === 0) return false;
  if (giftable(job)) return false;
  return giftCodeValid(job.id, job.founderWallet, code, nowSec);
}

export type GiftClaim = { ok: true } | { ok: false; reason: "no_such_job" | "bad_wallet" | "bad_code" | "already_claimed" | GiftRefusal };

/**
 * Move a gifted plan to the signed-in wallet: atomic on the owner the code was signed for, so two claims
 * can't both win and a claimed gift can't be claimed again. Claiming your own plan is a no-op success.
 */
export function claimGift(inspectionId: string, code: unknown, wallet: string, nowSec = nowSeconds()): GiftClaim {
  const job = getInspectionJob(inspectionId);
  if (!job) return { ok: false, reason: "no_such_job" };
  if (normalizeFounder(wallet) === null) return { ok: false, reason: "bad_wallet" };
  if (sameFounder(job.founderWallet, wallet)) return { ok: true };
  const refused = giftable(job);
  if (refused) return { ok: false, reason: refused };
  if (!giftCodeValid(inspectionId, job.founderWallet, code, nowSec)) return { ok: false, reason: "bad_code" };
  const res = db
    .update(inspectionJobs)
    .set({ founderWallet: founderStorageKey(wallet), updatedAt: nowSec })
    .where(and(eq(inspectionJobs.id, inspectionId), eq(inspectionJobs.founderWallet, job.founderWallet)))
    .run();
  return (res.changes ?? 0) > 0 ? { ok: true } : { ok: false, reason: "already_claimed" };
}
