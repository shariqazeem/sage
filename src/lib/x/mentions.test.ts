import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionJobs, planRevisions, xCursor, xMentions, xPosts, xSpend } from "@/lib/db/schema";
import { claimInspectionJob, getInspectionJob, listInspectionJobs } from "@/lib/db/inspection";
import { founderStorageKey, normalizeFounder, sameFounder } from "@/lib/auth/founder";
import { resolveCanaryIdentity } from "@/lib/launch/job";
import { runXAgent, type XAgentDeps } from "./agent";
import { spentMicros } from "./budget";
import type { XClient, XMentionPost, XMentionsPage, XResult, XUser } from "./client";
import { claimXDraft, xDraftFor, xOwnerKey } from "./drafts";
import { judgeMention, productLink } from "./mentions";
import { CURSOR, cursorGet, cursorSet, getMention, getPost } from "./store";

/**
 * The tag flow: who Sage answers, that it starts its own inspection through the same door a founder
 * uses, that it replies once and only under the post that summoned it, and who owns what it drafted.
 */

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0) / 1000;
const TICK = 300;
const SELF = { id: "999", username: "sagepaysai" };
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const OLD_ACCOUNT = iso(NOW - 400 * 86_400);

function post(id: string, over: Partial<XMentionPost> = {}): XMentionPost {
  return {
    id,
    text: "@sagepaysai try this",
    authorId: "42",
    createdAt: iso(NOW + 60),
    conversationId: id,
    urls: ["https://acme.app/"],
    mentions: ["sagepaysai"],
    referenced: [],
    ...over,
  };
}
const user = (id: string, over: Partial<XUser> = {}): XUser => ({ id, username: `user${id}`, createdAt: OLD_ACCOUNT, ...over });

function fakeClient(opts: { pages?: XMentionsPage[]; answer?: (sent: { text: string; replyTo?: string }) => XResult<{ id: string }> } = {}) {
  const sent: { text: string; replyTo?: string }[] = [];
  const reads: (string | null | undefined)[] = [];
  let meCalls = 0;
  const pages = [...(opts.pages ?? [])];
  const client: XClient = {
    async createPost(input) {
      sent.push(input);
      return opts.answer ? opts.answer(input) : { ok: true, data: { id: `tw${sent.length}` } };
    },
    async me() {
      meCalls += 1;
      return { ok: true, data: { ...SELF, createdAt: null } };
    },
    async mentions(_userId, o) {
      reads.push(o?.sinceId);
      return { ok: true, data: pages.shift() ?? { posts: [], users: [], newestId: null } };
    },
  };
  return { sent, reads, client, meCalls: () => meCalls };
}

const page = (posts: XMentionPost[], users: XUser[] = [user("42")]): XMentionsPage => ({ posts, users, newestId: posts.at(-1)?.id ?? null });

const runInspection = vi.fn(async () => undefined);
const scheduled: (() => Promise<void>)[] = [];
const deps = (client: XClient, extra: XAgentDeps = {}): XAgentDeps => ({
  mode: "live",
  client,
  repliesOn: true,
  budgetMicros: 2_000_000,
  inspectionsCap: 10,
  runInspection,
  schedule: (fn) => void scheduled.push(fn),
  ...extra,
});

/** Mark the inspection a tag started as finished, with a plan of `places` at `rewardBase` each. */
function finish(jobId: string, opts: { places?: number; rewardBase?: number; pages?: number } = {}) {
  const places = opts.places ?? 10;
  const reward = opts.rewardBase ?? 2_000_000;
  db.update(inspectionJobs).set({ status: "ready", pagesInspected: opts.pages ?? 6 }).where(eq(inspectionJobs.id, jobId)).run();
  db.insert(planRevisions)
    .values({
      id: `rev-${jobId}`,
      jobId,
      revisionNumber: 1,
      authorWallet: "x:42",
      planJson: { missions: [{ rewardBase: String(reward), maxCompletions: String(places) }], allocatedBase: String(reward * places) },
      budgetBase: reward * places,
      campaignIdHash: "0x0",
      missionPlanDigest: "0x0",
      createdAt: NOW,
    })
    .run();
}

beforeEach(() => {
  for (const t of [xPosts, xMentions, xCursor, xSpend, planRevisions, inspectionJobs]) db.delete(t).run();
  runInspection.mockClear();
  scheduled.length = 0;
  // Sage has been listening since before these posts were made
  cursorSet(CURSOR.listeningSince, String(NOW - 3600), NOW - 3600);
});

describe("which tags Sage answers", () => {
  it("answers a tag with a product link from an account over thirty days old", () => {
    expect(judgeMention(post("1"), user("42"), SELF, NOW)).toEqual({ ok: true, url: "https://acme.app/" });
  });

  it("ignores its own posts, reposts, and posts that don't tag it", () => {
    expect(judgeMention(post("1", { authorId: "999" }), user("999"), SELF, NOW)).toEqual({ ok: false, reason: "Sage's own post" });
    expect(judgeMention(post("1", { referenced: [{ type: "retweeted", id: "5" }] }), user("42"), SELF, NOW)).toMatchObject({ ok: false });
    expect(judgeMention(post("1", { mentions: ["someoneelse"] }), user("42"), SELF, NOW)).toEqual({ ok: false, reason: "did not tag Sage" });
  });

  it("ignores a tag with no product link", () => {
    expect(judgeMention(post("1", { urls: [] }), user("42"), SELF, NOW)).toEqual({ ok: false, reason: "no product link" });
    expect(judgeMention(post("1", { urls: ["https://x.com/a/status/1", "https://t.co/abc", "http://acme.app/"] }), user("42"), SELF, NOW)).toEqual({ ok: false, reason: "no product link" });
  });

  it("takes the first link that is a product, not X", () => {
    expect(productLink(["https://twitter.com/a/status/1", "https://acme.app/pricing", "https://other.io"])).toBe("https://acme.app/pricing");
  });

  it("ignores an author whose account is under thirty days old, or whose age is unknown", () => {
    expect(judgeMention(post("1"), user("42", { createdAt: iso(NOW - 29 * 86_400) }), SELF, NOW)).toEqual({ ok: false, reason: "account under 30 days old" });
    expect(judgeMention(post("1"), user("42", { createdAt: iso(NOW - 31 * 86_400) }), SELF, NOW).ok).toBe(true);
    expect(judgeMention(post("1"), undefined, SELF, NOW)).toEqual({ ok: false, reason: "account age unknown" });
  });
});

describe("the tag flow", () => {
  it("reads nothing and starts nothing while replies are off", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    await runXAgent(NOW, deps(x.client, { repliesOn: false }));
    expect(x.reads).toEqual([]);
    expect(x.meCalls()).toBe(0);
    expect(getMention("100")).toBeNull();
  });

  it("starts Sage's own inspection for a valid tag, owned by the X account that asked", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    const s = await runXAgent(NOW, deps(x.client));
    expect(s.mentions).toEqual({ read: 1, started: 1, ignored: 0 });
    const m = getMention("100");
    expect(m).toMatchObject({ state: "trying", authorId: "42", authorUsername: "user42", url: "https://acme.app/" });
    const job = getInspectionJob(m?.startedId ?? "");
    expect(job).toMatchObject({ founderWallet: "x:42", productUrl: "https://acme.app/", totalBudgetBase: 20_000_000, status: "queued", goal: "" });
    // the pipeline runs off the sweep's response, through the scheduler it was handed
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(runInspection).toHaveBeenCalledWith(job?.id);
    // nothing is said until the inspection is done
    expect(x.sent).toEqual([]);
    expect(cursorGet(CURSOR.sinceId)).toBe("100");
  });

  it("reads who it is once, then reads from where it left off", async () => {
    const x = fakeClient({ pages: [page([post("100")]), page([], [])] });
    await runXAgent(NOW, deps(x.client));
    await runXAgent(NOW + TICK, deps(x.client));
    expect(x.meCalls()).toBe(1);
    expect(x.reads).toEqual([null, "100"]);
    // one user read, then one page with a post and a user, then an empty page
    expect(spentMicros(NOW)).toBe(10_000 + (5_000 + 10_000) + 1_000);
  });

  it("never starts two inspections for one post, even if X returns it twice", async () => {
    const x = fakeClient({ pages: [page([post("100")]), page([post("100")])] });
    await runXAgent(NOW, deps(x.client));
    await runXAgent(NOW + TICK, deps(x.client));
    expect(listInspectionJobs("x:42")).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
  });

  it("starts one inspection per person per day", async () => {
    const x = fakeClient({ pages: [page([post("100"), post("101", { urls: ["https://other.io/"] })])] });
    const s = await runXAgent(NOW, deps(x.client));
    expect(s.mentions.started).toBe(1);
    expect(getMention("101")).toMatchObject({ state: "ignored", reason: "one a day per person" });
    // and again the next day
    const next = fakeClient({ pages: [page([post("200", { createdAt: iso(NOW + 86_400) })])] });
    await runXAgent(NOW + 86_400, deps(next.client));
    expect(getMention("200")?.state).toBe("trying");
  });

  it("stops at the daily cap for tagged links", async () => {
    const posts = [post("100", { authorId: "1" }), post("101", { authorId: "2" }), post("102", { authorId: "3" })];
    const x = fakeClient({ pages: [page(posts, [user("1"), user("2"), user("3")])] });
    const s = await runXAgent(NOW, deps(x.client, { inspectionsCap: 2 }));
    expect(s.mentions.started).toBe(2);
    expect(getMention("102")).toMatchObject({ state: "ignored", reason: "daily limit for tagged links reached" });
  });

  it("never answers a backlog: posts made before it started listening are ignored", async () => {
    db.delete(xCursor).run();
    const x = fakeClient({ pages: [page([post("90", { createdAt: iso(NOW - 600) })])] });
    await runXAgent(NOW, deps(x.client));
    expect(getMention("90")).toMatchObject({ state: "ignored", reason: "posted before Sage started listening" });
    expect(scheduled).toEqual([]);
    expect(cursorGet(CURSOR.listeningSince)).toBe(String(NOW));
  });

  it("records a tag it won't answer, with the reason, and says nothing", async () => {
    const x = fakeClient({ pages: [page([post("100", { urls: [] })])] });
    const s = await runXAgent(NOW, deps(x.client));
    expect(s.mentions).toEqual({ read: 1, started: 0, ignored: 1 });
    expect(getMention("100")).toMatchObject({ state: "ignored", reason: "no product link", startedId: null });
    expect(x.sent).toEqual([]);
  });

  it("refuses a link the launch door refuses, and says nothing", async () => {
    const x = fakeClient({ pages: [page([post("100", { urls: ["https://192.168.1.10/admin"] })])] });
    await runXAgent(NOW, deps(x.client));
    expect(getMention("100")?.state).toBe("ignored");
    expect(scheduled).toEqual([]);
    expect(x.sent).toEqual([]);
  });
});

describe("the reply", () => {
  async function tagged(x: ReturnType<typeof fakeClient>, extra: XAgentDeps = {}) {
    await runXAgent(NOW, deps(x.client, extra));
    return getMention("100")?.startedId ?? "";
  }

  it("is sent once, under the post that tagged Sage, when the test is ready", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    const jobId = await tagged(x);
    await runXAgent(NOW + TICK, deps(x.client));
    expect(x.sent).toEqual([]); // still trying
    finish(jobId, { places: 10, rewardBase: 2_000_000, pages: 6 });
    await runXAgent(NOW + 2 * TICK, deps(x.client));
    await runXAgent(NOW + 3 * TICK, deps(x.client));
    expect(x.sent).toEqual([{ text: `I tried acme.app and opened 6 pages. A test is ready: 10 places, $20. http://localhost:3000/t/${jobId}`, replyTo: "100" }]);
    expect(getMention("100")?.state).toBe("replied");
    expect(getPost("reply:100")).toMatchObject({ kind: "reply", status: "posted", inReplyTo: "100", costMicros: 200_000 });
  });

  it("names no one: the reply carries no handle", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    finish(await tagged(x));
    await runXAgent(NOW + TICK, deps(x.client));
    expect(x.sent[0].text).not.toContain("@");
  });

  it("records X's 403 as skipped with X's reason, and never tries again", async () => {
    const x = fakeClient({
      pages: [page([post("100")])],
      answer: () => ({ ok: false, kind: "forbidden", detail: "Reply to this conversation is not allowed because you have not been mentioned." }),
    });
    finish(await tagged(x));
    await runXAgent(NOW + TICK, deps(x.client));
    await runXAgent(NOW + 2 * TICK, deps(x.client));
    expect(x.sent).toHaveLength(1);
    expect(getPost("reply:100")).toMatchObject({ status: "skipped", reason: "X: Reply to this conversation is not allowed because you have not been mentioned." });
    expect(getMention("100")).toMatchObject({ state: "ignored" });
    expect(spentMicros(NOW)).toBe(10_000 + 15_000 + 1_000 + 1_000); // reads only: the refused reply cost nothing
  });

  it("says so, with no link of its own, when it couldn't open the product", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    const jobId = await tagged(x);
    db.update(inspectionJobs).set({ status: "failed", failureReason: "no_inspected_pages" }).where(eq(inspectionJobs.id, jobId)).run();
    await runXAgent(NOW + TICK, deps(x.client));
    expect(x.sent).toEqual([{ text: "I couldn't open acme.app: nothing loaded for me, or the site blocks automated visits.", replyTo: "100" }]);
    expect(x.sent[0].text).not.toContain("/t/");
  });

  it("stays silent when the failure was on Sage's side", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    const jobId = await tagged(x);
    db.update(inspectionJobs).set({ status: "failed", failureReason: "provider_timeout" }).where(eq(inspectionJobs.id, jobId)).run();
    await runXAgent(NOW + TICK, deps(x.client));
    expect(x.sent).toEqual([]);
    expect(getMention("100")).toMatchObject({ state: "ignored", reason: "inspection failed: provider_timeout" });
  });

  it("stays silent when the drafted plan doesn't add up", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    const jobId = await tagged(x);
    finish(jobId);
    db.update(planRevisions).set({ planJson: { missions: [{ rewardBase: "2000000", maxCompletions: "10" }], allocatedBase: "19000000" } }).where(eq(planRevisions.jobId, jobId)).run();
    await runXAgent(NOW + TICK, deps(x.client));
    expect(x.sent).toEqual([]);
    expect(getMention("100")).toMatchObject({ state: "ignored", reason: "the drafted plan could not be read" });
  });

  it("gives up quietly on an inspection that never finishes", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    await tagged(x);
    await runXAgent(NOW + 3 * 3600, deps(x.client));
    expect(x.sent).toEqual([]);
    expect(getMention("100")).toMatchObject({ state: "ignored", reason: "the inspection did not finish in time" });
  });

  it("drafts the reply in a dry run and sends nothing, then or later", async () => {
    const x = fakeClient({ pages: [page([post("100")])] });
    finish(await tagged(x, { mode: "dry" }));
    await runXAgent(NOW + TICK, deps(x.client, { mode: "dry" }));
    expect(x.sent).toEqual([]);
    expect(getPost("reply:100")).toMatchObject({ status: "drafted", reason: "dry run" });
    expect(getMention("100")?.state).toBe("ignored");
    await runXAgent(NOW + 2 * TICK, deps(x.client)); // live now: a stale tag is not answered late
    expect(x.sent).toEqual([]);
  });
});

describe("who owns a test a tag started", () => {
  const WALLET = `0x${"ab".repeat(20)}`;

  async function drafted() {
    const x = fakeClient({ pages: [page([post("100")])] });
    await runXAgent(NOW, deps(x.client));
    return getMention("100")?.startedId ?? "";
  }

  it("an x: owner passes through the founder key untouched and equals no wallet", () => {
    expect(founderStorageKey(xOwnerKey("42"))).toBe("x:42");
    expect(normalizeFounder("x:42")).toBeNull();
    expect(sameFounder("x:42", WALLET)).toBe(false);
    expect(sameFounder("x:42", "x:42")).toBe(false); // no door admits it by comparison, not even to itself
    expect(resolveCanaryIdentity("x:42")).toBeNull();
  });

  it("no wallet can take it through the ordinary claim", async () => {
    const jobId = await drafted();
    expect(claimInspectionJob(jobId, WALLET)).toEqual({ ok: false, reason: "already_claimed_by_another_wallet" });
    expect(getInspectionJob(jobId)?.founderWallet).toBe("x:42");
  });

  it("xDraftFor names the X account that asked, by inspection id or campaign id", async () => {
    const jobId = await drafted();
    const job = getInspectionJob(jobId);
    expect(xDraftFor(jobId)).toEqual({ xUserId: "42", username: "user42", inspectionId: jobId, unclaimed: true });
    expect(xDraftFor(job?.publicCampaignId ?? "")).toMatchObject({ xUserId: "42", inspectionId: jobId });
    expect(xDraftFor("nope")).toBeNull();
  });

  it("only the same X account can claim it, once, for a real wallet", async () => {
    const jobId = await drafted();
    expect(claimXDraft(jobId, "43", WALLET)).toEqual({ ok: false, reason: "not_your_draft" });
    expect(claimXDraft(jobId, "user42", WALLET)).toEqual({ ok: false, reason: "not_your_draft" });
    expect(claimXDraft(jobId, "42", "not-a-wallet")).toEqual({ ok: false, reason: "bad_wallet" });
    expect(getInspectionJob(jobId)?.founderWallet).toBe("x:42");

    expect(claimXDraft(jobId, "42", WALLET)).toEqual({ ok: true });
    expect(getInspectionJob(jobId)?.founderWallet).toBe(WALLET);
    expect(claimXDraft(jobId, "42", WALLET)).toEqual({ ok: true }); // the same claim again is fine
    expect(claimXDraft(jobId, "42", `0x${"cd".repeat(20)}`)).toEqual({ ok: false, reason: "already_claimed" });
    // it stays on record as tag-started, and is now an ordinary plan owned by that wallet
    expect(xDraftFor(jobId)).toMatchObject({ xUserId: "42", unclaimed: false });
    expect(sameFounder(getInspectionJob(jobId)?.founderWallet, WALLET)).toBe(true);
  });

  it("is null for a test that started any other way", () => {
    expect(xDraftFor("launch-acme-abc")).toBeNull();
  });
});
