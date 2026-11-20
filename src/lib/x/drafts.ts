import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { getInspectionJob, getInspectionJobByCampaign } from "@/lib/db/inspection";
import { founderStorageKey, normalizeFounder } from "@/lib/auth/founder";
import { nowSeconds } from "@/lib/db/keys";
import { mentionForInspection } from "./store";

/**
 * WHO OWNS A TEST THAT A TAG STARTED.
 *
 * When someone tags Sage with a product link, Sage tries the product and drafts a test. Nobody has
 * signed in, so there is no wallet to own it. The inspection is filed under the X account that asked:
 * `x:<userId>`, the same kind of ownership namespace a Telegram or agent-started inspection already
 * uses (`clawup:<ref>`, see `resolveCanaryIdentity`).
 *
 * WHY THAT IS SAFE ON EVERY PATH (checked 20 Nov 2026):
 *   - `founderStorageKey("x:123")` lower-cases a short string and returns it; nothing parses it.
 *   - `normalizeFounder("x:123")` is null, so `sameFounder(x-owner, anyWallet)` is always FALSE. Every
 *     door that acts on a plan (approve, revise, clarify, retry, the claim challenge) admits the owner
 *     or an "anonymous" job, so an `x:` job admits NO wallet: it fails closed, not open.
 *   - `claimInspectionJob` moves a job only from "anonymous", so no wallet can take an `x:` job there.
 *   - Reading stays open, as for every plan: `GET /api/launch/<id>` answers "other" for it.
 *   - Nothing calls `getAddress()` on an inspection's owner; the canary identity resolves to null.
 *
 * "anonymous" would have been the unsafe choice: anyone holding the link could claim an anonymous
 * plan, and the link is in a public reply.
 *
 * THE CONTRACT THE RUN PAGE (`/t/<id>`) MUST HONOUR:
 *   1. Anyone may VIEW a drafted test. No sign-in.
 *   2. `xDraftFor(id)` says whether a tag started it and which X account asked.
 *   3. To claim and pay, the visitor must prove they are that same X account (a sign-in with X whose
 *      verified user id equals `xUserId`: compare the id, never the handle, a handle can be renamed
 *      and re-registered). Only then call `claimXDraft(id, verifiedXUserId, wallet)`, which hands the
 *      inspection to their wallet. From there it is an ordinary plan owned by that wallet.
 *   4. Never pass a user id that came from the page, the URL or the request body.
 */
export const X_OWNER_PREFIX = "x:";

export function xOwnerKey(xUserId: string): string {
  return `${X_OWNER_PREFIX}${xUserId}`;
}

/** X user ids are decimal strings. Anything else is not an id we wrote. */
function isXUserId(v: string): boolean {
  return /^[0-9]{1,24}$/.test(v);
}

export type XDraft = {
  /** the X account that tagged Sage: the only account that may claim this test */
  xUserId: string;
  /** its handle when the tag was read, for display only */
  username: string | null;
  /** the inspection the tag started */
  inspectionId: string;
  /** true while no wallet has claimed it */
  unclaimed: boolean;
};

/**
 * Was this test started by a tag on X, and by whom? Takes an inspection id or a campaign id.
 * Null for every test that started any other way.
 */
export function xDraftFor(id: string): XDraft | null {
  const job = getInspectionJob(id) ?? getInspectionJobByCampaign(id);
  if (!job) return null;
  const mention = mentionForInspection(job.id);
  const owner = job.founderWallet.startsWith(X_OWNER_PREFIX) ? job.founderWallet.slice(X_OWNER_PREFIX.length) : null;
  // the mention row is the record of who asked; the owner column agrees with it until a wallet claims
  const xUserId = mention?.authorId ?? owner;
  if (!xUserId || !isXUserId(xUserId)) return null;
  if (owner !== null && owner !== xUserId) return null; // two records that disagree prove nothing
  return { xUserId, username: mention?.authorUsername ?? null, inspectionId: job.id, unclaimed: owner !== null };
}

export type ClaimXDraftResult =
  | { ok: true }
  | { ok: false; reason: "not_an_x_draft" | "not_your_draft" | "bad_wallet" | "already_claimed" };

/**
 * Hand a tag-started inspection to the wallet of the person who tagged Sage.
 *
 * `verifiedXUserId` MUST come from a server-verified sign-in with X. Atomic on the current owner, so
 * two claims cannot both win, and repeating a claim that already succeeded for the same wallet is ok.
 */
export function claimXDraft(id: string, verifiedXUserId: string, wallet: string): ClaimXDraftResult {
  const draft = xDraftFor(id);
  if (!draft) return { ok: false, reason: "not_an_x_draft" };
  if (!isXUserId(verifiedXUserId) || verifiedXUserId !== draft.xUserId) return { ok: false, reason: "not_your_draft" };
  if (normalizeFounder(wallet) === null) return { ok: false, reason: "bad_wallet" };
  const key = founderStorageKey(wallet);
  const job = getInspectionJob(draft.inspectionId);
  if (job && job.founderWallet === key) return { ok: true };
  const res = db
    .update(inspectionJobs)
    .set({ founderWallet: key, updatedAt: nowSeconds() })
    .where(and(eq(inspectionJobs.id, draft.inspectionId), eq(inspectionJobs.founderWallet, xOwnerKey(draft.xUserId))))
    .run();
  return (res.changes ?? 0) > 0 ? { ok: true } : { ok: false, reason: "already_claimed" };
}
