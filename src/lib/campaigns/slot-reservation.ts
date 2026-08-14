/**
 * SLOT RESERVATION — Sage does not make a promise it cannot keep.
 *
 * When a tester's account falls short but looks honest, Sage says "refine this and resubmit". That is
 * an invitation, and until 2026-08-14 it was worthless: slots were consumed only on PAYMENT, so
 * anyone could take the last one while the invited tester was rewriting. Measured on the first funded
 * campaign — a tester submitted to the wrong mission, was invited back, and the mission filled while
 * they were fixing it. They did the work twice and got nothing.
 *
 * So an open invitation HOLDS A PLACE, on a clock:
 *
 *   claimed = paid + settling + live invitations
 *
 * The clock starts when Sage issues the invitation (the hold event), not when the tester first
 * submitted, so each round of coaching gets a full window. It expires, because a held place that
 * never lapses lets one tester park a slot forever.
 *
 * DELIBERATELY NOT RESERVED: a final hold awaiting the founder's judgment. Those can sit for days,
 * and blocking a live campaign on unreviewed work starves it — measured on clawup M2, where two weak
 * accounts would have locked out the two best ones. The cost of that choice is real and stated: if a
 * founder later wants to release a held submission after the slots filled, the vault will refuse.
 * Reviewing promptly is the answer to that, not freezing the marketplace.
 *
 * Pure + deterministic: no DB, no clock of its own — every input is passed in.
 */

/** How long an open invitation holds the tester's place. Long enough to rewrite an account honestly,
 *  short enough that a no-show doesn't strand the mission. */
export const RETRY_RESERVATION_MINUTES = 30;

/** The reason token `observationRetryLine` stamps on a retry invitation, matched from the journal. */
export const OBSERVATION_RETRY_TOKEN = "(observation_retry)";

export interface SlotClaimant {
  /** submission status at read time. */
  status: string;
  /** the latest hold reason Sage journalled for it, or null if it has never been held. */
  lastHoldReason: string | null;
  /** unix seconds of that hold — when the invitation was issued. */
  lastHeldAt: number | null;
}

export interface SlotStatus {
  /** slots that can never come back: paid, or mid-settlement. */
  taken: number;
  /** slots held by a live invitation — these DO come back. */
  reserved: number;
  /** unix seconds when the earliest reservation lapses, or null when nothing is reserved. */
  nextOpensAt: number | null;
  /** what a new tester can claim right now. */
  open: number;
}

/** Is this claimant sitting on a live invitation? */
function hasLiveInvitation(c: SlotClaimant, now: number, windowSeconds: number): boolean {
  if (c.status !== "pending") return false;
  if (!c.lastHoldReason || c.lastHeldAt == null) return false;
  if (!c.lastHoldReason.includes(OBSERVATION_RETRY_TOKEN)) return false;
  return now - c.lastHeldAt < windowSeconds;
}

/**
 * How many of a mission's slots are spoken for, and when the next one frees up.
 * `maxCompletions` is the vault's own cap — this never reports more open than that.
 */
export function missionSlotStatus(
  claimants: readonly SlotClaimant[],
  maxCompletions: number,
  now: number,
  reservationMinutes = RETRY_RESERVATION_MINUTES,
): SlotStatus {
  const windowSeconds = Math.max(0, Math.round(reservationMinutes * 60));
  let taken = 0;
  let reserved = 0;
  let earliestExpiry: number | null = null;
  for (const c of claimants) {
    if (c.status === "paid" || c.status === "settling") {
      taken++;
      continue;
    }
    if (hasLiveInvitation(c, now, windowSeconds)) {
      reserved++;
      const expiry = (c.lastHeldAt as number) + windowSeconds;
      if (earliestExpiry === null || expiry < earliestExpiry) earliestExpiry = expiry;
    }
  }
  const open = Math.max(0, maxCompletions - taken - reserved);
  return { taken, reserved, nextOpensAt: reserved > 0 ? earliestExpiry : null, open };
}

/**
 * The sentence a tester sees when every slot is spoken for but some are only HELD. It must never
 * read as a rejection — they have done nothing yet, and the slot is genuinely coming back.
 */
export function slotsHeldMessage(status: SlotStatus, now: number): string {
  const mins = status.nextOpensAt ? Math.max(1, Math.ceil((status.nextOpensAt - now) / 60)) : null;
  const held = `${status.reserved} ${status.reserved === 1 ? "is" : "are"} held for ${status.reserved === 1 ? "a tester" : "testers"} finishing a revision`;
  return mins
    ? `Every slot on this mission is spoken for right now — ${held}. Check back in about ${mins} minute${mins === 1 ? "" : "s"}: if they don't finish, the slot opens again.`
    : `Every slot on this mission is spoken for right now — ${held}.`;
}
