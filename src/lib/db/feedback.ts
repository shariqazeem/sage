import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { feedback, type FeedbackRow } from "./schema";

/**
 * Feedback rows — write-once from the public API, read by the operator. All bounding/validation
 * happens at the API door; this module only persists what was already accepted.
 */

export interface NewFeedback {
  message: string;
  contact: string | null;
  page: string | null;
  inspectionId: string | null;
  surface: string;
}

function feedbackId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `fb_${s}`;
}

export function recordFeedback(input: NewFeedback): FeedbackRow {
  const row: FeedbackRow = {
    id: feedbackId(),
    message: input.message,
    contact: input.contact,
    page: input.page,
    inspectionId: input.inspectionId,
    surface: input.surface,
    createdAt: nowSeconds(),
  };
  db.insert(feedback).values(row).run();
  return row;
}

/**
 * When (if ever) feedback was left on a specific inspection.
 *
 * The feedback widget already records the inspection it was sent from, which makes "did this person
 * actually use Sage AND tell us what they thought" a DETERMINISTIC pair rather than a claim: the
 * inspection row proves the run, this row proves the feedback, and both are keyed to the same id.
 * The plan page surfaces it so the fact is publicly checkable — which is what lets a mission ask for
 * it and still be auto-payable, instead of resting on the tester's word.
 *
 * Returns the EARLIEST feedback timestamp: the first time they spoke, not the last.
 */
export function feedbackAtForInspection(inspectionId: string): number | null {
  const rows = db
    .select({ createdAt: feedback.createdAt })
    .from(feedback)
    .where(eq(feedback.inspectionId, inspectionId))
    .all();
  if (rows.length === 0) return null;
  return rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), rows[0].createdAt);
}

/** Newest-first listing for the operator (scoreboard / review tooling). */
export function listFeedback(limit = 50): FeedbackRow[] {
  return db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(limit).all();
}
