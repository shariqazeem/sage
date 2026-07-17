import "server-only";

/**
 * A founder's release request that hasn't been confirmed yet — kept server-side (never in the
 * model's hands) so sage_confirm_release settles EXACTLY the submission that was prepared; the
 * agent can't swap it. In-memory + one-per-chat (a fresh request replaces the prior), mirroring the
 * concierge's ORIGINAL withdraw pattern. Deliberately not durable: a lost pending release is
 * trivially re-requested, and skipping a boot-time migration keeps a live-campaign deploy low-risk.
 */
interface PendingReview {
  campaignId: string;
  submissionId: string;
  expiresAt: number;
}

const TTL_SECONDS = 5 * 60;
const store = new Map<string, PendingReview>();
const now = (): number => Math.floor(Date.now() / 1000);

/** Store (or replace) the pending release for a chat. */
export function putPendingReview(chatId: string, campaignId: string, submissionId: string): void {
  store.set(chatId, { campaignId, submissionId, expiresAt: now() + TTL_SECONDS });
}

/** Consume the pending release for a chat EXACTLY ONCE (deleted on read; null if expired/absent). */
export function consumePendingReview(
  chatId: string,
): { campaignId: string; submissionId: string } | null {
  const p = store.get(chatId);
  if (!p) return null;
  store.delete(chatId);
  if (p.expiresAt < now()) return null;
  return { campaignId: p.campaignId, submissionId: p.submissionId };
}
