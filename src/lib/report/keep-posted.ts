import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { keepPosted } from "@/lib/db/schema";
import { nowSeconds } from "@/lib/db/keys";

/**
 * KEEP ME POSTED (relaunch, 20 Nov 2026).
 *
 * A tester who liked what they tried can say so: "the builder may reach me here". It is theirs to
 * give and theirs to take back, one contact of their choosing, per answer. The row IS the consent:
 * no row, no contact. Only the test's owner reads a contact (`findingsView` strips it for anyone
 * else), and the route decides who may write one.
 */
export type ContactKind = "x" | "email" | "wallet";
export const CONTACT_KINDS: readonly ContactKind[] = ["x", "email", "wallet"];

export interface KeepPostedContact {
  submissionId: string;
  kind: ContactKind;
  contact: string;
  /** when they said yes (epoch seconds). */
  at: number;
}

export function getKeepPosted(submissionId: string): KeepPostedContact | null {
  const r = db.select().from(keepPosted).where(eq(keepPosted.submissionId, submissionId)).get();
  return r ? { submissionId: r.submissionId, kind: r.contactKind, contact: r.contact, at: r.createdAt } : null;
}

/** Say yes, or change which contact is shared. Saying the same thing twice changes nothing. */
export function setKeepPosted(input: { submissionId: string; campaignId: string; kind: ContactKind; contact: string }, now = nowSeconds()): KeepPostedContact {
  const before = getKeepPosted(input.submissionId);
  if (before && before.kind === input.kind && before.contact === input.contact) return before;
  const set = { campaignId: input.campaignId, contactKind: input.kind, contact: input.contact, createdAt: now };
  db.insert(keepPosted)
    .values({ submissionId: input.submissionId, ...set })
    .onConflictDoUpdate({ target: keepPosted.submissionId, set })
    .run();
  return { submissionId: input.submissionId, kind: input.kind, contact: input.contact, at: now };
}

/** Take it back. True when there was a yes to withdraw. */
export function withdrawKeepPosted(submissionId: string): boolean {
  return db.delete(keepPosted).where(eq(keepPosted.submissionId, submissionId)).run().changes > 0;
}

/** Everyone who said yes on this test, oldest first. For the owner's eyes only. */
export function listKeepPosted(campaignId: string): KeepPostedContact[] {
  return db
    .select()
    .from(keepPosted)
    .where(eq(keepPosted.campaignId, campaignId))
    .orderBy(asc(keepPosted.createdAt), asc(keepPosted.submissionId))
    .all()
    .map((r) => ({ submissionId: r.submissionId, kind: r.contactKind, contact: r.contact, at: r.createdAt }));
}
