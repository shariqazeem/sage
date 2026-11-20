import "server-only";
import type { InspectionJob } from "@/lib/db/schema";
import { getCurrentRevision } from "@/lib/db/plan-revisions";
import { siteUrl } from "@/lib/site";
import { testUrl } from "@/lib/site/test-url";
import type { XMentionPost, XUser } from "./client";
import { domainOf, replyFailedText, replyQuestionText, replyReadyText, type Composed } from "./compose";

/**
 * WHICH TAGS SAGE ANSWERS, AND WHAT IT SAYS BACK.
 *
 * X accepts a reply from an automated account only under a post whose author summoned it, so the only
 * posts considered are ones that tag Sage. Of those, Sage tries the product for an author whose account
 * is at least thirty days old and whose post carries a product link. Everything else is recorded as
 * ignored with the reason, and nothing is said: silence is the one answer that can't be turned into spam.
 */
export const MIN_ACCOUNT_AGE_DAYS = 30;
/** What a tag-started draft is sized to: the relaunch's default test. The builder changes it on the card. */
export const X_DRAFT_BUDGET_USD = 20;
/** A tagged link Sage is still trying after this long is given up on, quietly. */
export const TRYING_GIVE_UP_SECONDS = 2 * 3600;

const NOT_A_PRODUCT = new Set(["x.com", "twitter.com", "t.co", "pic.x.com", "pic.twitter.com", "mobile.twitter.com", "mobile.x.com"]);

export type MentionVerdict = { ok: true; url: string } | { ok: false; reason: string };

/** The first link in a post that could be a product: not X itself, and not Sage. */
export function productLink(urls: readonly string[]): string | null {
  const own = domainOf(siteUrl());
  for (const u of urls) {
    const host = domainOf(u);
    if (!host || NOT_A_PRODUCT.has(host) || host === own) continue;
    if (!u.startsWith("https://")) continue;
    return u;
  }
  return null;
}

/** The filters that need nothing but the post, its author and the clock. */
export function judgeMention(
  post: XMentionPost,
  author: XUser | undefined,
  self: { id: string; username: string },
  nowSec: number,
): MentionVerdict {
  if (post.authorId === self.id) return { ok: false, reason: "Sage's own post" };
  if (post.referenced.some((r) => r.type === "retweeted")) return { ok: false, reason: "a repost, not a tag" };
  if (!post.mentions.includes(self.username.toLowerCase())) return { ok: false, reason: "did not tag Sage" };
  const url = productLink(post.urls);
  if (!url) return { ok: false, reason: "no product link" };
  const made = author?.createdAt ? Math.floor(Date.parse(author.createdAt) / 1000) : NaN;
  if (!Number.isFinite(made)) return { ok: false, reason: "account age unknown" };
  if (nowSec - made < MIN_ACCOUNT_AGE_DAYS * 86_400) return { ok: false, reason: `account under ${MIN_ACCOUNT_AGE_DAYS} days old` };
  return { ok: true, url };
}

function toBig(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^[0-9]+$/.test(v)) return BigInt(v);
  } catch {
    /* not a whole number */
  }
  return null;
}

/** Paid places and the total of the drafted plan, read from the stored plan and nothing else. */
export function draftedPlanFacts(job: InspectionJob): { places: number; totalBase: bigint } | null {
  const plan = getCurrentRevision(job.id)?.planJson as { missions?: unknown; allocatedBase?: unknown } | null | undefined;
  if (!plan || !Array.isArray(plan.missions) || plan.missions.length === 0) return null;
  let places = BigInt(0);
  let sum = BigInt(0);
  for (const m of plan.missions as { rewardBase?: unknown; maxCompletions?: unknown }[]) {
    const reward = toBig(m?.rewardBase);
    const max = toBig(m?.maxCompletions);
    if (reward === null || max === null) return null;
    places += max;
    sum += reward * max;
  }
  const allocated = toBig(plan.allocatedBase);
  // the plan's own total must agree with its missions; a plan that doesn't add up is not quoted
  if (allocated !== null && allocated !== sum) return null;
  if (places <= BigInt(0) || sum <= BigInt(0) || places > BigInt(100_000)) return null;
  return { places: Number(places), totalBase: sum };
}

export type ReplyPlan =
  /** the inspection is still running */
  | { kind: "wait" }
  /** say this under the post that tagged Sage */
  | { kind: "reply"; composed: Composed }
  /** say nothing, and record why */
  | { kind: "silent"; reason: string };

/** What Sage answers for a tag, from where its inspection stands. */
export function replyFor(job: InspectionJob | null, startedAt: number, nowSec: number): ReplyPlan {
  if (!job) return { kind: "silent", reason: "its inspection is gone" };
  const domain = domainOf(job.productUrl);
  if (!domain) return { kind: "silent", reason: "the link has no plain domain" };
  const url = testUrl(job.id);
  const said = (composed: Composed | null): ReplyPlan =>
    composed ? { kind: "reply", composed } : { kind: "silent", reason: "the reply broke a writing rule" };

  if (job.status === "ready") {
    const facts = draftedPlanFacts(job);
    if (!facts) return { kind: "silent", reason: "the drafted plan could not be read" };
    return said(replyReadyText({ domain, pages: job.pagesInspected, places: facts.places, totalBase: facts.totalBase, url }));
  }
  if (job.status === "needs_input") return said(replyQuestionText({ domain, url }));
  if (job.status === "failed") {
    // Only a failure that is about the product is said in public. A failure on Sage's side is Sage's to fix.
    if (job.failureReason === "no_inspected_pages") {
      return said(replyFailedText({ domain, reason: "nothing loaded for me, or the site blocks automated visits" }));
    }
    return { kind: "silent", reason: `inspection failed: ${(job.failureReason ?? "unknown").slice(0, 120)}` };
  }
  if (job.status === "superseded") return { kind: "silent", reason: "the inspection was replaced" };
  if (nowSec - startedAt > TRYING_GIVE_UP_SECONDS) return { kind: "silent", reason: "the inspection did not finish in time" };
  return { kind: "wait" };
}
