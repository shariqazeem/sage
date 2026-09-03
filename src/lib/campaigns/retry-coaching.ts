import type { Submission } from "@/lib/db/schema";
import { MAX_ATTEMPTS, retryVerdict } from "@/lib/campaigns/retry";

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  attemptsLeft: number;
  retryable: boolean;
  /** The reason in the worker's terms, plus what to change — never a status word. */
  coaching: string;
}

export interface CoachingBrief {
  recommendation?: string | null;
  summary?: string | null;
  criteria?: ReadonlyArray<{ criterion?: string | null; met?: boolean | null }> | null;
  fraudSignals?: ReadonlyArray<{ severity?: string | null }> | null;
}

const firstSentence = (s: string) => {
  const t = s.trim();
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).slice(0, 240);
};

/**
 * The worker's next move on a url-lane (gig / grant / testing) submission that did not pay.
 *
 * The board used to say "Not accepted this time" and "Held — needs a human look" and stop. The
 * founder's refusal reason was stored and never shown; the copy gate's reason was in the journal and
 * never shown; the judge's unmet criteria were in the brief and never summarised. A worker who
 * published on a paste service was told nothing they could act on, on a page with no form to act
 * from. Precedence: the founder's own words, then the autopilot's reason, then the criteria the
 * judge could not confirm, then the judge's summary.
 *
 * Returns null while the submission is still being judged (no decision, not refused) and for the
 * terminal states (paid / settling / approved / blocked) — those have nothing to revise.
 */
export function urlLaneRetry(
  sub: Pick<Submission, "status" | "attempt" | "rejectReason">,
  brief: CoachingBrief | null,
  autopayHeldReason: string | null,
): RetryState | null {
  if (sub.status === "paid" || sub.status === "settling" || sub.status === "approved" || sub.status === "blocked") return null;
  const refused = sub.status === "rejected";
  const held = !!brief && (brief.recommendation !== "pay" || !!autopayHeldReason);
  if (!refused && !held) return null;

  const attempt = sub.attempt ?? 1;
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempt);
  const verdict = retryVerdict({ status: sub.status, attempt }, brief);
  const retryable = verdict.ok && attemptsLeft > 0;

  let why: string | null = null;
  const reason = sub.rejectReason?.trim();
  if (refused && reason) why = reason;
  else if (autopayHeldReason) why = `Sage verified the page but held the payout: ${autopayHeldReason}.`;
  else if (brief) {
    const unmet = (brief.criteria ?? []).filter((c) => c.met === false && c.criterion).map((c) => String(c.criterion).trim());
    if (unmet.length > 0) {
      const shown = unmet.slice(0, 3).map((c) => (c.length > 110 ? `${c.slice(0, 107)}…` : c));
      why = `Sage couldn't confirm ${unmet.length === 1 ? "this" : `${unmet.length} things`} on your page: ${shown.join("; ")}${unmet.length > 3 ? "; …" : ""}.`;
    } else if (brief.summary) why = firstSentence(brief.summary);
  }
  if (!why) why = refused ? "The founder didn't accept this submission." : "Sage couldn't verify this submission from the link.";

  const next = retryable
    ? ` Fix that, then resubmit the link — ${attemptsLeft === 1 ? "1 attempt" : `${attemptsLeft} attempts`} left.`
    : verdict.ok
      ? ""
      : ` ${verdict.error}`;
  return { attempt, maxAttempts: MAX_ATTEMPTS, attemptsLeft, retryable, coaching: `${why}${next}` };
}
