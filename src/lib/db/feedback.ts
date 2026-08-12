import "server-only";

import { desc } from "drizzle-orm";
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

/** Newest-first listing for the operator (scoreboard / review tooling). */
export function listFeedback(limit = 50): FeedbackRow[] {
  return db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(limit).all();
}
