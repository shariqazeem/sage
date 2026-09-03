/**
 * MAY THIS WALLET REVISE ITS SUBMISSION? — the one rule for both lanes.
 *
 * Testing reports could always be revised while held (P20, up to OBS_MAX_ATTEMPTS). A gig
 * submission could not: one row per wallet per mission, so a founder's refusal — or a hold for a
 * page that was thin — was final, and the coached "fix it and resubmit" the product promises
 * elsewhere was a dead end here. Same bar for both now: a refused or held (non-fraud) submission
 * may be revised in place; an approved one is with the founder; a fraud hold is final.
 */
import type { Submission } from "@/lib/db/schema";

export const MAX_ATTEMPTS = 3;

export interface RetryBrief {
  recommendation?: string | null;
  fraudSignals?: ReadonlyArray<{ severity?: string | null }> | null;
}

export type RetryVerdict = { ok: true } | { ok: false; error: string };

export function retryVerdict(existing: Pick<Submission, "status" | "attempt">, brief: RetryBrief | null, maxAttempts = MAX_ATTEMPTS): RetryVerdict {
  if (existing.status === "paid") return { ok: false, error: "This wallet has already been paid for this mission." };
  if (existing.status === "blocked" || existing.status === "settling" || existing.status === "approved") {
    return { ok: false, error: "This submission is already approved or settling — it can't be revised." };
  }
  if ((brief?.fraudSignals ?? []).some((f) => f.severity === "high")) {
    return { ok: false, error: "This submission was held for a fraud signal and is with the founder — it can't be revised." };
  }
  // A refusal outranks the brief: the founder can refuse work the judge approved (a paste-service
  // page, a copy the gate caught), and that worker must be able to republish and resubmit — the
  // stale "pay" is not a payout waiting to happen.
  if (brief?.recommendation === "pay" && existing.status !== "rejected") {
    return { ok: false, error: "This submission is already approved and waiting to be paid — it can't be revised." };
  }
  if ((existing.attempt ?? 1) >= maxAttempts) {
    return { ok: false, error: `You've used all ${maxAttempts} attempts on this mission — it's now with the founder for review.` };
  }
  return { ok: true };
}
