import "server-only";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { xCursor, xMentions, xPosts, type XMention, type XMentionState, type XPost, type XPostKind, type XPostStatus } from "@/lib/db/schema";

/** The rows behind Sage on X. Every reader and writer of the `x_*` tables goes through here. */

/* ───────────────────────────────────────────────────── posts ───────────── */

export function getPost(subjectKey: string): XPost | null {
  return db.select().from(xPosts).where(eq(xPosts.subjectKey, subjectKey)).get() ?? null;
}

export function listPosts(limit = 20): XPost[] {
  return db.select().from(xPosts).orderBy(desc(xPosts.id)).limit(limit).all();
}

/** Every subject that already has a row, so a tick can pass over them without a query each. */
export function subjectsOnRecord(): Map<string, XPost> {
  return new Map(db.select().from(xPosts).all().map((p) => [p.subjectKey, p]));
}

/**
 * Put a post on the record. One row per subject, ever: a second insert for the same subject changes
 * nothing and returns the row that was already there.
 */
export function recordPost(input: {
  kind: XPostKind;
  subjectKey: string;
  text: string;
  hasUrl: boolean;
  inReplyTo?: string | null;
  status: XPostStatus;
  reason?: string | null;
  now: number;
}): XPost {
  db.insert(xPosts)
    .values({
      kind: input.kind,
      subjectKey: input.subjectKey,
      text: input.text,
      hasUrl: input.hasUrl,
      inReplyTo: input.inReplyTo ?? null,
      status: input.status,
      reason: input.reason ?? null,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: xPosts.subjectKey })
    .run();
  return getPost(input.subjectKey) as XPost;
}

export function updatePost(
  id: number,
  patch: Partial<Pick<XPost, "text" | "hasUrl" | "status" | "reason" | "tweetId" | "costMicros" | "postedAt">>,
): void {
  db.update(xPosts).set(patch).where(eq(xPosts.id, id)).run();
}

/* ─────────────────────────────────────────────────── mentions ──────────── */

export function getMention(tweetId: string): XMention | null {
  return db.select().from(xMentions).where(eq(xMentions.tweetId, tweetId)).get() ?? null;
}

/** Record a post that tagged Sage. Returns false when it was already on record (a re-read page). */
export function recordMention(row: {
  tweetId: string;
  authorId: string;
  authorUsername: string | null;
  authorCreatedAt: number | null;
  text: string;
  url: string | null;
  state: XMentionState;
  reason: string | null;
  now: number;
}): boolean {
  const res = db
    .insert(xMentions)
    .values({
      tweetId: row.tweetId,
      authorId: row.authorId,
      authorUsername: row.authorUsername,
      authorCreatedAt: row.authorCreatedAt,
      text: row.text,
      url: row.url,
      state: row.state,
      reason: row.reason,
      createdAt: row.now,
      handledAt: row.state === "new" ? null : row.now,
    })
    .onConflictDoNothing({ target: xMentions.tweetId })
    .run();
  return (res.changes ?? 0) > 0;
}

export function setMention(tweetId: string, patch: { state: XMentionState; reason?: string | null; startedId?: string | null; now: number }): void {
  db.update(xMentions)
    .set({
      state: patch.state,
      reason: patch.reason ?? null,
      ...(patch.startedId === undefined ? {} : { startedId: patch.startedId }),
      handledAt: patch.now,
    })
    .where(eq(xMentions.tweetId, tweetId))
    .run();
}

export function mentionsIn(state: XMentionState): XMention[] {
  return db.select().from(xMentions).where(eq(xMentions.state, state)).orderBy(xMentions.createdAt).all();
}

/** Inspections tagged links started since `sinceSec`, whoever asked. */
export function inspectionsStartedSince(sinceSec: number): number {
  return db
    .select({ id: xMentions.tweetId })
    .from(xMentions)
    .where(and(isNotNull(xMentions.startedId), gte(xMentions.createdAt, sinceSec)))
    .all().length;
}

/** Inspections this one author's tags started since `sinceSec`. */
export function inspectionsStartedBy(authorId: string, sinceSec: number): number {
  return db
    .select({ id: xMentions.tweetId })
    .from(xMentions)
    .where(and(eq(xMentions.authorId, authorId), isNotNull(xMentions.startedId), gte(xMentions.createdAt, sinceSec)))
    .all().length;
}

/** The mention that started this inspection, if a tag started it. */
export function mentionForInspection(inspectionId: string): XMention | null {
  return (
    db
      .select()
      .from(xMentions)
      .where(and(eq(xMentions.startedId, inspectionId), inArray(xMentions.state, ["trying", "replied", "ignored"])))
      .get() ?? null
  );
}

/* ───────────────────────────────────────────────────── cursor ──────────── */

export const CURSOR = {
  /** the newest mention already read */
  sinceId: "mentions_since_id",
  /** the agent account's own user id and handle, read once */
  selfId: "self_id",
  selfUsername: "self_username",
  /** X said "not before this second" (a 429's reset) */
  rateLimitedUntil: "rate_limited_until",
  /** when Sage first read its mentions (epoch seconds): nothing older is ever answered */
  listeningSince: "listening_since",
} as const;

export function cursorGet(key: string): string | null {
  return db.select().from(xCursor).where(eq(xCursor.key, key)).get()?.value ?? null;
}

export function cursorSet(key: string, value: string, now: number): void {
  db.insert(xCursor)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: xCursor.key, set: { value, updatedAt: now } })
    .run();
}
