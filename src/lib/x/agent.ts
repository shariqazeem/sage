import "server-only";
import type { Campaign, XPost, XPostKind } from "@/lib/db/schema";
import { countPaidForMission, listCampaigns, listLiveCampaigns, listMissions, listSubmissions } from "@/lib/db/campaigns";
import { getInspectionJob, productUrlForCampaign } from "@/lib/db/inspection";
import { nowSeconds } from "@/lib/db/keys";
import { startInspection } from "@/lib/launch/start";
import { runInspectionJob } from "@/lib/launch/job";
import { sharingFor } from "@/lib/sharing";
import { testUrl } from "@/lib/site/test-url";
import { BUDGET_REACHED, bookSpend, canSpend, spentMicros, utcDayStart } from "./budget";
import { createXClient, type XClient } from "./client";
import { domainOf, missionText, plainWords, resultText, type Composed } from "./compose";
import { xCredentials, xDailyBudgetMicros, xInspectionsDailyCap, xMode, xRepliesOn, type XMode } from "./config";
import { xOwnerKey } from "./drafts";
import { X_DRAFT_BUDGET_USD, judgeMention, replyFor } from "./mentions";
import { X_PRICES_MICROS, postCostMicros, readCostMicros } from "./prices";
import { resultFactsFor, type ResultFacts } from "./result-facts";
import {
  CURSOR,
  cursorGet,
  cursorSet,
  getPost,
  inspectionsStartedBy,
  inspectionsStartedSince,
  mentionsIn,
  recordMention,
  recordPost,
  setMention,
  subjectsOnRecord,
  updatePost,
} from "./store";

/**
 * SAGE ON X: ONE BOUNDED STEP OF THE SWEEP.
 *
 * Three things, each only with someone's yes:
 *   1. a test's mission, while places are open, when its builder opted in (`sharingFor().postMission`);
 *   2. what people found, once the test has ended, when its builder opted in (`postResult`);
 *   3. a reply under a post that tagged Sage with a product link, when the founder armed replies.
 *
 * It never likes, follows, reposts or messages, never names a handle, and never replies under a post
 * that didn't summon it: the client has no call for the first four and the composer refuses an `@`.
 *
 * RECORDED BEFORE IT HAPPENS. A post is written as `drafted` and only then sent. A crash between the
 * two leaves a draft that may or may not be out; the next tick sends the SAME text again, and X's own
 * refusal of a repeated text is the proof it was already posted. That is why a possibly-sent draft is
 * never rewritten: a changed text is how one subject would become two posts.
 *
 * `off` does nothing at all. `dry` writes the drafts (reason "dry run") and sends nothing.
 */

/** At most this many posts are attempted in one tick, so a backlog can never become a burst. */
export const MAX_POSTS_PER_TICK = 3;
/** A draft X never answered for is given up on after a day. */
const DRAFT_GIVE_UP_SECONDS = 24 * 3600;
/** A tag is answered within a day or not at all. */
const REPLY_TOO_LATE_SECONDS = 24 * 3600;
const MENTIONS_PER_READ = 10;

export const DRY_RUN = "dry run";
export const RATE_LIMITED = "X rate limit";
export const BAD_KEYS = "X refused the credentials";
/** Skips that say "not now", not "never": the subject is tried again when the cause has passed. */
const NOT_NOW: ReadonlySet<string> = new Set([BUDGET_REACHED, RATE_LIMITED, BAD_KEYS]);

const ENDED: ReadonlySet<string> = new Set(["cancelled", "completed", "closed"]);
const IN_FLIGHT: ReadonlySet<string> = new Set(["pending", "approved", "settling"]);
const METIS = 1088;

export type XAgentSummary = {
  mode: XMode;
  posted: number;
  drafted: number;
  skipped: number;
  failed: number;
  mentions: { read: number; started: number; ignored: number };
  /** today's spend on X after this tick, in millionths of a dollar */
  spentMicros: number;
  /** why the agent stopped early this tick, if it did */
  held: string | null;
};

export type XAgentDeps = {
  mode?: XMode;
  /** null means "no credentials": nothing can be sent or read */
  client?: XClient | null;
  repliesOn?: boolean;
  budgetMicros?: number;
  inspectionsCap?: number;
  /** runs the inspection off the sweep's own response (the sweep passes `after`) */
  schedule?: (fn: () => Promise<void>) => void;
  startInspection?: typeof startInspection;
  runInspection?: (jobId: string) => Promise<void>;
  /** the findings seam, for tests */
  resultFacts?: (campaignId: string) => ResultFacts;
};

type Draft = { kind: XPostKind; subjectKey: string; composed: Composed; inReplyTo?: string };
type Outcome = XPost["status"] | "deferred";

export async function runXAgent(nowSec: number = nowSeconds(), deps: XAgentDeps = {}): Promise<XAgentSummary> {
  let mode = deps.mode ?? xMode();
  const summary: XAgentSummary = {
    mode,
    posted: 0,
    drafted: 0,
    skipped: 0,
    failed: 0,
    mentions: { read: 0, started: 0, ignored: 0 },
    spentMicros: 0,
    held: null,
  };
  if (mode === "off") return summary;

  const creds = deps.client === undefined ? xCredentials() : null;
  const client = deps.client !== undefined ? deps.client : creds ? createXClient(creds) : null;
  if (mode === "live" && !client) mode = summary.mode = "dry";
  const budget = deps.budgetMicros ?? xDailyBudgetMicros();
  let attempts = 0;
  let halted = false;

  const limitedUntil = Number(cursorGet(CURSOR.rateLimitedUntil) ?? 0);
  if (limitedUntil > nowSec) {
    // X named the second it will answer again. Until then nothing is sent or read; drafts still record in a dry run.
    halted = true;
    summary.held = RATE_LIMITED;
  }

  /** Is there nothing more to do for this subject? */
  const settled = (row: XPost | null | undefined): boolean => {
    if (!row) return false;
    if (mode === "dry") return true; // a dry run only ever adds drafts for subjects with no row
    if (row.status === "posted" || row.status === "failed") return true;
    if (row.status === "skipped") return !NOT_NOW.has(row.reason ?? "");
    return false; // drafted: a dry-run draft to send now, or one that may already be out
  };

  /** Put a subject on the record and, when live, send it. One post per subject, ever. */
  async function publish(d: Draft): Promise<Outcome> {
    const existing = getPost(d.subjectKey);
    if (settled(existing)) return (existing as XPost).status;
    if (attempts >= MAX_POSTS_PER_TICK) return "deferred";

    if (mode === "dry" || !client) {
      attempts += 1;
      recordPost({ ...d, text: d.composed.text, hasUrl: d.composed.hasUrl, status: "drafted", reason: DRY_RUN, now: nowSec });
      summary.drafted += 1;
      return "drafted";
    }
    if (halted) return "deferred";

    // A draft with no reason was written just before a send: it may already be on X.
    const sentBefore = existing && existing.status === "drafted" && existing.reason === null ? existing : null;
    const maybeSent = sentBefore !== null;
    if (sentBefore && nowSec - sentBefore.createdAt > DRAFT_GIVE_UP_SECONDS) {
      updatePost(sentBefore.id, { status: "failed", reason: "no answer from X for a day" });
      summary.failed += 1;
      return "failed";
    }
    const text = sentBefore ? sentBefore.text : d.composed.text;
    const cost = postCostMicros(text);
    if (!canSpend(cost, nowSec, budget)) {
      summary.held = BUDGET_REACHED;
      if (maybeSent) return "deferred"; // left exactly as it is, for tomorrow
      if (existing) updatePost(existing.id, { text, hasUrl: d.composed.hasUrl, status: "skipped", reason: BUDGET_REACHED });
      else {
        recordPost({ ...d, text, hasUrl: d.composed.hasUrl, status: "skipped", reason: BUDGET_REACHED, now: nowSec });
        summary.skipped += 1;
      }
      return "skipped";
    }

    // ON THE RECORD FIRST, then sent.
    let row: XPost;
    if (existing) {
      if (!maybeSent) updatePost(existing.id, { text, hasUrl: d.composed.hasUrl, status: "drafted", reason: null });
      row = existing;
    } else {
      row = recordPost({ ...d, text, hasUrl: d.composed.hasUrl, status: "drafted", reason: null, now: nowSec });
    }
    attempts += 1;
    const res = await client.createPost({ text, replyTo: row.inReplyTo ?? d.inReplyTo });

    if (res.ok) {
      bookSpend(cost, nowSec);
      updatePost(row.id, { status: "posted", reason: null, tweetId: res.data.id || null, costMicros: cost, postedAt: nowSec });
      summary.posted += 1;
      return "posted";
    }
    switch (res.kind) {
      case "duplicate":
        if (maybeSent) {
          // X already has this exact text from this account: the send before the crash went through.
          bookSpend(cost, nowSec);
          updatePost(row.id, { status: "posted", reason: "X already had this text: it was sent before a restart", costMicros: cost, postedAt: nowSec });
          summary.posted += 1;
          return "posted";
        }
        updatePost(row.id, { status: "skipped", reason: `X refused a repeated text: ${res.detail}` });
        summary.skipped += 1;
        return "skipped";
      case "rate_limited":
        cursorSet(CURSOR.rateLimitedUntil, String(res.resetAt), nowSec);
        halted = true;
        summary.held = RATE_LIMITED;
        // a 429 means it was not posted; a draft that may be out from an earlier send stays as it is
        if (!maybeSent) updatePost(row.id, { status: "skipped", reason: RATE_LIMITED });
        return "deferred";
      case "unauthorized":
        halted = true;
        summary.held = BAD_KEYS;
        if (!maybeSent) updatePost(row.id, { status: "skipped", reason: BAD_KEYS });
        return "deferred";
      case "forbidden":
        // For a reply this is X's rule speaking (the author did not summon Sage, or replies are not
        // approved): recorded as skipped with X's reason. For an original post it is a failure.
        if (d.kind === "reply") {
          updatePost(row.id, { status: "skipped", reason: `X: ${res.detail}` });
          summary.skipped += 1;
          return "skipped";
        }
        updatePost(row.id, { status: "failed", reason: `X: ${res.detail}` });
        summary.failed += 1;
        return "failed";
      case "error":
        if (res.status >= 500) {
          halted = true; // X is unwell: the draft stays, and the same text is sent again next tick
          summary.held = `X answered ${res.status}`;
          return "deferred";
        }
        updatePost(row.id, { status: "failed", reason: `X answered ${res.status}: ${res.detail}` });
        summary.failed += 1;
        return "failed";
      case "network":
        halted = true; // it may or may not have arrived; the same text is sent again next tick
        summary.held = "X could not be reached";
        return "deferred";
    }
  }

  /** A subject that can never be posted is closed on the record, so it is considered once. */
  function close(kind: XPostKind, subjectKey: string, reason: string): void {
    if (getPost(subjectKey)) return;
    recordPost({ kind, subjectKey, text: "", hasUrl: false, status: "skipped", reason, now: nowSec });
    summary.skipped += 1;
  }

  const more = () => attempts < MAX_POSTS_PER_TICK && !(halted && mode === "live");

  /* ── 3 first: someone is waiting ── replies to posts that tagged Sage ─────────────────────── */
  if ((deps.repliesOn ?? xRepliesOn()) && client && !halted) {
    await readMentions();
    startNewMentions();
    for (const m of mentionsIn("trying")) {
      if (!more()) break;
      if (nowSec - m.createdAt > REPLY_TOO_LATE_SECONDS) {
        setMention(m.tweetId, { state: "ignored", reason: "too late to answer", now: nowSec });
        continue;
      }
      const plan = replyFor(m.startedId ? getInspectionJob(m.startedId) : null, m.handledAt ?? m.createdAt, nowSec);
      if (plan.kind === "wait") continue;
      if (plan.kind === "silent") {
        setMention(m.tweetId, { state: "ignored", reason: plan.reason, now: nowSec });
        summary.mentions.ignored += 1;
        continue;
      }
      const subjectKey = `reply:${m.tweetId}`;
      const outcome = await publish({ kind: "reply", subjectKey, composed: plan.composed, inReplyTo: m.tweetId });
      if (outcome === "posted") setMention(m.tweetId, { state: "replied", now: nowSec });
      else if (outcome === "drafted") setMention(m.tweetId, { state: "ignored", reason: "dry run: the reply was drafted, not sent", now: nowSec });
      else if (outcome === "failed" || (outcome === "skipped" && !NOT_NOW.has(getPost(subjectKey)?.reason ?? ""))) {
        setMention(m.tweetId, { state: "ignored", reason: getPost(subjectKey)?.reason ?? "the reply was not sent", now: nowSec });
      }
      // otherwise (budget, rate limit, cap): still trying, answered on a later tick
    }
  }

  /* ── 1 ── a test's mission, while places are open, with the builder's yes ─────────────────── */
  const onRecord = subjectsOnRecord();
  for (const c of listLiveCampaigns()) {
    if (!more()) break;
    if (c.sandbox || c.visibility !== "listed" || c.safetyHold || c.kind !== "testing") continue;
    const subjectKey = `mission:${c.id}`;
    if (settled(onRecord.get(subjectKey))) continue;
    if (!sharingFor(c.id).postMission) continue; // no answer from the builder is a no
    const open = openPlaces(c);
    if (open.places <= 0) continue;
    const product = productName(c);
    if (!product) {
      close("mission", subjectKey, "no product name that can be posted");
      continue;
    }
    const composed = missionText({
      product,
      places: open.places,
      rewardMinBase: open.rewardMinBase,
      rewardMaxBase: open.rewardMaxBase,
      onMetis: c.chainId === METIS,
      url: testUrl(c.id),
    });
    if (!composed) {
      close("mission", subjectKey, "the text broke a writing rule");
      continue;
    }
    await publish({ kind: "mission", subjectKey, composed });
  }

  /* ── 2 ── what people found, once the test has ended, with the builder's yes ──────────────── */
  const facts = deps.resultFacts ?? ((id: string) => resultFactsFor(id));
  for (const c of listCampaigns()) {
    if (!more()) break;
    if (c.sandbox || c.safetyHold || c.kind !== "testing" || c.status === "draft") continue;
    const subjectKey = `result:${c.id}`;
    if (settled(onRecord.get(subjectKey))) continue;
    const stopped = ENDED.has(c.status);
    if (!stopped && c.status !== "live") continue;
    if (!sharingFor(c.id).postResult) continue;
    if (!stopped && !isFull(c)) continue;
    const subs = listSubmissions(c.id);
    if (subs.some((s) => IN_FLIGHT.has(s.status))) continue; // something is still being decided or paid
    const people = new Set(subs.filter((s) => s.status === "paid").map((s) => s.wallet.toLowerCase())).size;
    if (people === 0) {
      if (stopped) close("result", subjectKey, "nobody was paid");
      continue;
    }
    const product = productName(c);
    if (!product) {
      close("result", subjectKey, "no product name that can be posted");
      continue;
    }
    const found = facts(c.id);
    const composed = resultText({ product, people, finding: found.finding, quote: found.quote, onMetis: c.chainId === METIS, url: testUrl(c.id) });
    if (!composed) {
      close("result", subjectKey, "the text broke a writing rule");
      continue;
    }
    await publish({ kind: "result", subjectKey, composed });
  }

  summary.spentMicros = spentMicros(nowSec);
  return summary;

  /* ───────────────────────────────────────────────── the tag flow ───────── */

  /** Read the posts that tagged Sage since the last read, and put each on the record. */
  async function readMentions(): Promise<void> {
    if (!client) return;
    let selfId = cursorGet(CURSOR.selfId);
    let selfUsername = cursorGet(CURSOR.selfUsername);
    if (!selfId || !selfUsername) {
      if (!canSpend(X_PRICES_MICROS.userRead, nowSec, budget)) return void (summary.held = BUDGET_REACHED);
      const me = await client.me();
      if (!me.ok) return void noteReadFailure(me);
      bookSpend(X_PRICES_MICROS.userRead, nowSec);
      selfId = me.data.id;
      selfUsername = me.data.username;
      cursorSet(CURSOR.selfId, selfId, nowSec);
      cursorSet(CURSOR.selfUsername, selfUsername, nowSec);
    }
    // Sage answers tags made after it started listening, never a backlog.
    let listeningSince = Number(cursorGet(CURSOR.listeningSince) ?? 0);
    if (!listeningSince) {
      listeningSince = nowSec;
      cursorSet(CURSOR.listeningSince, String(nowSec), nowSec);
    }
    const worstCase = MENTIONS_PER_READ * (X_PRICES_MICROS.postRead + X_PRICES_MICROS.userRead);
    if (!canSpend(worstCase, nowSec, budget)) return void (summary.held = BUDGET_REACHED);

    const page = await client.mentions(selfId, { sinceId: cursorGet(CURSOR.sinceId), maxResults: MENTIONS_PER_READ });
    if (!page.ok) return void noteReadFailure(page);
    bookSpend(readCostMicros({ posts: page.data.posts.length, users: page.data.users.length }), nowSec);

    const authors = new Map(page.data.users.map((u) => [u.id, u]));
    const oldestFirst = [...page.data.posts].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    for (const post of oldestFirst) {
      const author = authors.get(post.authorId);
      const made = post.createdAt ? Math.floor(Date.parse(post.createdAt) / 1000) : NaN;
      const verdict =
        Number.isFinite(made) && made < listeningSince
          ? ({ ok: false, reason: "posted before Sage started listening" } as const)
          : judgeMention(post, author, { id: selfId, username: selfUsername }, nowSec);
      const authorMade = author?.createdAt ? Math.floor(Date.parse(author.createdAt) / 1000) : NaN;
      const fresh = recordMention({
        tweetId: post.id,
        authorId: post.authorId,
        authorUsername: author?.username ?? null,
        authorCreatedAt: Number.isFinite(authorMade) ? authorMade : null,
        text: post.text.slice(0, 1000),
        url: verdict.ok ? verdict.url : null,
        state: verdict.ok ? "new" : "ignored",
        reason: verdict.ok ? null : verdict.reason,
        now: nowSec,
      });
      if (fresh) {
        summary.mentions.read += 1;
        if (!verdict.ok) summary.mentions.ignored += 1;
      }
    }
    // the cursor moves only after every post it covers is on the record
    const newest = page.data.newestId ?? oldestFirst.at(-1)?.id ?? null;
    if (newest) cursorSet(CURSOR.sinceId, newest, nowSec);
  }

  function noteReadFailure(f: { kind: string; resetAt?: number }): void {
    if (f.kind === "rate_limited" && typeof f.resetAt === "number") {
      cursorSet(CURSOR.rateLimitedUntil, String(f.resetAt), nowSec);
      summary.held = RATE_LIMITED;
    } else if (f.kind === "unauthorized") summary.held = BAD_KEYS;
    else summary.held = "X could not be read";
    halted = true;
  }

  /** For each tag that passed the filters: the daily limits, then Sage's own inspection of the link. */
  function startNewMentions(): void {
    const cap = deps.inspectionsCap ?? xInspectionsDailyCap();
    const dayStart = utcDayStart(nowSec);
    const start = deps.startInspection ?? startInspection;
    const run = deps.runInspection ?? runInspectionJob;
    const schedule = deps.schedule ?? ((fn: () => Promise<void>) => void fn().catch(() => undefined));
    for (const m of mentionsIn("new")) {
      const ignore = (reason: string) => {
        setMention(m.tweetId, { state: "ignored", reason, now: nowSec });
        summary.mentions.ignored += 1;
      };
      if (!m.url) { ignore("no product link"); continue; }
      if (inspectionsStartedBy(m.authorId, dayStart) >= 1) { ignore("one a day per person"); continue; }
      if (inspectionsStartedSince(dayStart) >= cap) { ignore("daily limit for tagged links reached"); continue; }
      // The SAME door a founder's launch goes through (validation, the SSRF guard, one job per request).
      // The request id is the tag's own id, so reading a post twice can never start two inspections.
      const owner = xOwnerKey(m.authorId);
      const started = start({
        productUrl: m.url,
        goal: "",
        targetUsers: "",
        budgetUsd: X_DRAFT_BUDGET_USD,
        founder: owner,
        planningRequestId: `prid:api:x-${m.tweetId}`,
        surface: "x",
        actor: owner,
      });
      if (!started.ok) { ignore(`not started: ${started.error.slice(0, 160)}`); continue; }
      setMention(m.tweetId, { state: "trying", startedId: started.job.id, now: nowSec });
      summary.mentions.started += 1;
      const jobId = started.job.id;
      if (started.created) schedule(() => run(jobId));
    }
  }
}

/* ───────────────────────────────────────────────── facts from the database ─── */

/** What a test is called in public: its product's domain, or its title when that is plain words. */
export function productName(c: Campaign): string | null {
  return domainOf(productUrlForCampaign(c.id)) ?? plainWords(c.title, 60);
}

/** Places still open, and the smallest and largest reward among them. Read from paid submissions. */
export function openPlaces(c: Campaign): { places: number; total: number; rewardMinBase: number; rewardMaxBase: number } {
  const missions = listMissions(c.id).filter((m) => m.status === "active");
  if (missions.length === 0) {
    const paid = listSubmissions(c.id).filter((s) => s.status === "paid").length;
    const places = Math.max(0, c.maxRecipients - paid);
    return { places, total: c.maxRecipients, rewardMinBase: c.rewardAmount, rewardMaxBase: c.rewardAmount };
  }
  let places = 0;
  let total = 0;
  let min = Infinity;
  let max = 0;
  for (const m of missions) {
    const open = Math.max(0, m.maxCompletions - countPaidForMission(m.missionIdHash));
    total += m.maxCompletions;
    if (open === 0) continue;
    places += open;
    min = Math.min(min, m.rewardAmount);
    max = Math.max(max, m.rewardAmount);
  }
  return { places, total, rewardMinBase: Number.isFinite(min) ? min : 0, rewardMaxBase: max };
}

function isFull(c: Campaign): boolean {
  const open = openPlaces(c);
  return open.total > 0 && open.places === 0;
}
