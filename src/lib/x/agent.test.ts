import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignSharing, campaigns, missions, submissions, xCursor, xMentions, xPosts, xSpend } from "@/lib/db/schema";
import { createCampaign, createMission, createSubmission } from "@/lib/db/campaigns";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { setSharing } from "@/lib/sharing";
import { BAD_KEYS, DRY_RUN, MAX_POSTS_PER_TICK, RATE_LIMITED, runXAgent, type XAgentDeps } from "./agent";
import { BUDGET_REACHED, spentMicros } from "./budget";
import type { XClient, XResult } from "./client";
import { CURSOR, cursorGet, getPost, listPosts, recordPost } from "./store";

/**
 * The state machine of a post: on the record before it is sent, one post per subject, a crash never
 * becomes a second post, a dry run sends nothing, off does nothing, and no opt-in means no post.
 */

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0) / 1000;
const TICK = 300;

type Sent = { text: string; replyTo?: string };

function fakeClient(answer?: (sent: Sent, n: number) => XResult<{ id: string }>) {
  const sent: Sent[] = [];
  const client: XClient = {
    async createPost(input) {
      sent.push(input);
      return answer ? answer(input, sent.length) : { ok: true, data: { id: `tw${sent.length}` } };
    },
    async me() {
      return { ok: true, data: { id: "999", username: "sagepaysai", createdAt: null } };
    },
    async mentions() {
      return { ok: true, data: { posts: [], users: [], newestId: null } };
    },
  };
  return { sent, client };
}

let n = 0;
function seedTest(opts: { places?: number; rewardBase?: number; status?: string; title?: string; visibility?: "listed" | "unlisted"; chainId?: number } = {}) {
  const reward = opts.rewardBase ?? 2_000_000;
  const c = createCampaign({
    title: opts.title ?? `Acme Notes ${++n}`,
    rewardAmount: reward,
    vaultAddress: `0x${"3".repeat(40)}`,
    posterWallet: `0x${"4".repeat(40)}`,
    chainId: opts.chainId ?? 1088,
    vaultKind: "campaign_v2",
    criteria: [],
    status: opts.status ?? "live",
    visibility: opts.visibility ?? "listed",
  });
  const mid = missionIdHash(c.id, "try");
  createMission({
    campaignId: c.id,
    missionKey: "try",
    missionIdHash: mid,
    title: "Try it",
    rewardAmount: reward,
    maxCompletions: opts.places ?? 10,
    displayOrder: 0,
  });
  return { id: c.id, mid };
}

let w = 0;
function pay(campaignId: string, mid: string, note: string) {
  const wallet = `0x${(++w).toString(16).padStart(40, "0")}`;
  const r = createSubmission({ campaignId, wallet, evidenceUrl: null, note, missionIdHash: mid, missionSpecDigest: null });
  if (!r.ok) throw new Error(`seed failed: ${r.error}`);
  db.update(submissions).set({ status: "paid" }).where(eq(submissions.id, r.submission.id)).run();
}

const live = (client: XClient, extra: XAgentDeps = {}): XAgentDeps => ({ mode: "live", client, repliesOn: false, budgetMicros: 2_000_000, ...extra });

beforeEach(() => {
  for (const t of [xPosts, xMentions, xCursor, xSpend, campaignSharing, submissions, missions, campaigns]) db.delete(t).run();
});

describe("consent", () => {
  it("posts nothing for a test whose builder never answered", async () => {
    seedTest();
    const { sent, client } = fakeClient();
    const s = await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    expect(listPosts()).toEqual([]);
    expect(s.posted).toBe(0);
  });

  it("posts the mission only when the builder said yes to the mission", async () => {
    const a = seedTest();
    const b = seedTest();
    setSharing(a.id, { postResult: true, findingsPublic: true });
    setSharing(b.id, { postMission: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toHaveLength(1);
    expect(getPost(`mission:${a.id}`)).toBeNull();
    expect(getPost(`mission:${b.id}`)?.status).toBe("posted");
  });

  it("posts the result only when the builder said yes to the result", async () => {
    const a = seedTest({ status: "cancelled" });
    const b = seedTest({ status: "cancelled" });
    pay(a.id, a.mid, "I got stuck on the pricing page because the button did nothing.");
    pay(b.id, b.mid, "I got stuck on the pricing page because the button did nothing.");
    setSharing(a.id, { postMission: true });
    setSharing(b.id, { postResult: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toHaveLength(1);
    expect(getPost(`result:${a.id}`)).toBeNull();
    expect(getPost(`result:${b.id}`)?.status).toBe("posted");
  });

  it("never posts a members-only test's mission, even with a yes", async () => {
    const t = seedTest({ visibility: "unlisted" });
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
  });
});

describe("off and dry", () => {
  it("does nothing at all when off", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    const s = await runXAgent(NOW, { mode: "off", client });
    expect(sent).toEqual([]);
    expect(listPosts()).toEqual([]);
    expect(s).toMatchObject({ mode: "off", posted: 0, drafted: 0 });
  });

  it("is off by default", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const s = await runXAgent(NOW);
    expect(s.mode).toBe("off");
    expect(listPosts()).toEqual([]);
  });

  it("records what it would post in a dry run and sends nothing", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    const s = await runXAgent(NOW, { mode: "dry", client });
    expect(sent).toEqual([]);
    expect(s.drafted).toBe(1);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "drafted", reason: DRY_RUN, tweetId: null, costMicros: 0 });
    expect(spentMicros(NOW)).toBe(0);
    // and it drafts each subject once, not once a tick
    await runXAgent(NOW + TICK, { mode: "dry", client });
    expect(listPosts()).toHaveLength(1);
  });

  it("treats live without credentials as a dry run", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const s = await runXAgent(NOW, { mode: "live", client: null });
    expect(s.mode).toBe("dry");
    expect(getPost(`mission:${t.id}`)?.reason).toBe(DRY_RUN);
  });

  it("sends a dry-run draft once the agent goes live, with today's facts", async () => {
    const t = seedTest({ places: 10 });
    setSharing(t.id, { postMission: true });
    await runXAgent(NOW, { mode: "dry", client: null });
    pay(t.id, t.mid, "done");
    const { sent, client } = fakeClient();
    await runXAgent(NOW + TICK, live(client));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("9 places");
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "posted", reason: null, tweetId: "tw1" });
    expect(listPosts()).toHaveLength(1);
  });
});

describe("a mission post", () => {
  it("is on the record as drafted before it is sent", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    let seenAtSend: unknown = null;
    const { client } = fakeClient(() => {
      seenAtSend = getPost(`mission:${t.id}`);
      return { ok: true, data: { id: "tw-1" } };
    });
    await runXAgent(NOW, live(client));
    expect(seenAtSend).toMatchObject({ status: "drafted", reason: null, tweetId: null });
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "posted", tweetId: "tw-1", costMicros: 200_000, postedAt: NOW, hasUrl: true });
    expect(spentMicros(NOW)).toBe(200_000);
  });

  it("says the places open and the reward from the database", async () => {
    const t = seedTest({ places: 5, rewardBase: 2_500_000, title: "Acme Notes" });
    pay(t.id, t.mid, "done");
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent[0].text).toBe(`New test on Sage: try Acme Notes and tell us where you get stuck. 4 places, $2.50 each in USDC on Metis. http://localhost:3000/t/${t.id}`);
    expect(sent[0].replyTo).toBeUndefined();
  });

  it("is posted once per test, however many ticks pass", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    for (let i = 0; i < 4; i++) await runXAgent(NOW + i * TICK, live(client));
    expect(sent).toHaveLength(1);
    expect(listPosts()).toHaveLength(1);
  });

  it("is not written once every place is taken", async () => {
    const t = seedTest({ places: 1 });
    pay(t.id, t.mid, "done");
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    expect(getPost(`mission:${t.id}`)).toBeNull();
  });

  it("is closed on the record, unsent, when its name can't be said in public", async () => {
    const t = seedTest({ title: "Ask @bob about keys!" });
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "skipped", reason: "no product name that can be posted" });
  });

  it("attempts at most three posts in one tick", async () => {
    for (let i = 0; i < 5; i++) setSharing(seedTest().id, { postMission: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toHaveLength(MAX_POSTS_PER_TICK);
    await runXAgent(NOW + TICK, live(client));
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((s) => s.text)).size).toBe(5);
  });
});

describe("a crash, and X's refusal of a repeated text", () => {
  it("takes a duplicate refusal after a restart as proof it was posted, and never posts twice", async () => {
    const t = seedTest({ places: 10 });
    setSharing(t.id, { postMission: true });
    // the process died after the draft was written and the request left: nothing recorded the answer
    const lost = fakeClient(() => ({ ok: false, kind: "network", detail: "AbortError" }));
    const first = await runXAgent(NOW, live(lost.client));
    expect(first.held).toBe("X could not be reached");
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "drafted", reason: null });

    // a place was taken meanwhile: the text must NOT change, or one subject becomes two posts
    pay(t.id, t.mid, "done");
    const after = fakeClient(() => ({ ok: false, kind: "duplicate", detail: "duplicate content" }));
    await runXAgent(NOW + TICK, live(after.client));
    expect(after.sent[0].text).toBe(lost.sent[0].text);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "posted", costMicros: 200_000, postedAt: NOW + TICK });
    expect(getPost(`mission:${t.id}`)?.reason).toContain("sent before a restart");
    expect(spentMicros(NOW)).toBe(200_000);

    await runXAgent(NOW + 2 * TICK, live(after.client));
    expect(after.sent).toHaveLength(1);
    expect(listPosts()).toHaveLength(1);
  });

  it("sends the same text again when the first send never arrived", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const lost = fakeClient(() => ({ ok: false, kind: "error", status: 503, detail: "over capacity" }));
    await runXAgent(NOW, live(lost.client));
    const ok = fakeClient();
    await runXAgent(NOW + TICK, live(ok.client));
    expect(ok.sent[0].text).toBe(lost.sent[0].text);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "posted", tweetId: "tw1", reason: null });
  });

  it("gives up on a draft X never answered for after a day", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    recordPost({ kind: "mission", subjectKey: `mission:${t.id}`, text: "an old draft", hasUrl: false, status: "drafted", reason: null, now: NOW - 25 * 3600 });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "failed", reason: "no answer from X for a day" });
  });

  it("records a duplicate refusal of a fresh text as skipped, and never retries it", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient(() => ({ ok: false, kind: "duplicate", detail: "duplicate content" }));
    await runXAgent(NOW, live(client));
    await runXAgent(NOW + TICK, live(client));
    expect(sent).toHaveLength(1);
    expect(getPost(`mission:${t.id}`)?.status).toBe("skipped");
    expect(spentMicros(NOW)).toBe(0);
  });
});

describe("limits", () => {
  it("skips at the daily ceiling with the reason, and resumes the next UTC day", async () => {
    const a = seedTest();
    const b = seedTest();
    setSharing(a.id, { postMission: true });
    setSharing(b.id, { postMission: true });
    const { sent, client } = fakeClient();
    const s = await runXAgent(NOW, live(client, { budgetMicros: 300_000 })); // room for one post with a link
    expect(sent).toHaveLength(1);
    expect(s.held).toBe(BUDGET_REACHED);
    const rows = listPosts();
    expect(rows.map((r) => r.status).sort()).toEqual(["posted", "skipped"]);
    expect(rows.find((r) => r.status === "skipped")?.reason).toBe(BUDGET_REACHED);

    await runXAgent(NOW + TICK, live(client, { budgetMicros: 300_000 }));
    expect(sent).toHaveLength(1);

    await runXAgent(NOW + 86_400, live(client, { budgetMicros: 300_000 }));
    expect(sent).toHaveLength(2);
    expect(listPosts().every((r) => r.status === "posted")).toBe(true);
    expect(listPosts()).toHaveLength(2);
  });

  it("honours a 429: nothing more is sent until X's reset", async () => {
    const a = seedTest();
    const b = seedTest();
    setSharing(a.id, { postMission: true });
    setSharing(b.id, { postMission: true });
    const limited = fakeClient(() => ({ ok: false, kind: "rate_limited", resetAt: NOW + 900, detail: "Too Many Requests" }));
    const s = await runXAgent(NOW, live(limited.client));
    expect(limited.sent).toHaveLength(1);
    expect(s.held).toBe(RATE_LIMITED);
    expect(cursorGet(CURSOR.rateLimitedUntil)).toBe(String(NOW + 900));

    const ok = fakeClient();
    await runXAgent(NOW + TICK, live(ok.client));
    expect(ok.sent).toEqual([]);
    await runXAgent(NOW + 901, live(ok.client));
    expect(ok.sent).toHaveLength(2);
    expect(spentMicros(NOW)).toBe(400_000);
  });

  it("stops, keeps the subject, and says so when X refuses the credentials", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const bad = fakeClient(() => ({ ok: false, kind: "unauthorized", detail: "Unauthorized" }));
    const s = await runXAgent(NOW, live(bad.client));
    expect(s.held).toBe(BAD_KEYS);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "skipped", reason: BAD_KEYS });
    const ok = fakeClient();
    await runXAgent(NOW + TICK, live(ok.client));
    expect(getPost(`mission:${t.id}`)?.status).toBe("posted");
  });

  it("records a refused original post as failed with X's reason", async () => {
    const t = seedTest();
    setSharing(t.id, { postMission: true });
    const { sent, client } = fakeClient(() => ({ ok: false, kind: "forbidden", detail: "Your account is not permitted." }));
    await runXAgent(NOW, live(client));
    await runXAgent(NOW + TICK, live(client));
    expect(sent).toHaveLength(1);
    expect(getPost(`mission:${t.id}`)).toMatchObject({ status: "failed", reason: "X: Your account is not permitted." });
  });
});

describe("a result post", () => {
  it("says how many were paid and quotes one of them word for word", async () => {
    const t = seedTest({ status: "cancelled", title: "Acme Notes" });
    pay(t.id, t.mid, "ok");
    pay(t.id, t.mid, "I got stuck on the pricing page because the button did nothing. Then I left.");
    setSharing(t.id, { postResult: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent[0].text).toBe(
      `2 people tried Acme Notes. One said: “I got stuck on the pricing page because the button did nothing.” Each one checked and paid on Metis. http://localhost:3000/t/${t.id}`,
    );
  });

  it("uses the findings seam, and drops a quote the evidence doesn't hold", async () => {
    const t = seedTest({ status: "cancelled", title: "Acme Notes" });
    pay(t.id, t.mid, "The sign-up email took four minutes to arrive.");
    setSharing(t.id, { postResult: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client, { resultFacts: () => ({ finding: "Sign-up is slow", quote: null }) }));
    expect(sent[0].text).toContain("1 person tried Acme Notes.");
    expect(sent[0].text).toContain("Sign-up is slow.");
    expect(sent[0].text).not.toContain("“");
  });

  it("waits while a live test still has places, and posts once it is full", async () => {
    const t = seedTest({ places: 2 });
    setSharing(t.id, { postResult: true });
    pay(t.id, t.mid, "The first screen was clear and the second one was not.");
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    pay(t.id, t.mid, "done");
    await runXAgent(NOW + TICK, live(client));
    expect(sent).toHaveLength(1);
    expect(getPost(`result:${t.id}`)?.status).toBe("posted");
  });

  it("waits while a submission is still being decided", async () => {
    const t = seedTest({ status: "cancelled" });
    pay(t.id, t.mid, "The first screen was clear and the second one was not.");
    const r = createSubmission({ campaignId: t.id, wallet: `0x${"9".repeat(40)}`, evidenceUrl: null, note: "mine", missionIdHash: t.mid, missionSpecDigest: null });
    if (!r.ok) throw new Error("seed failed");
    setSharing(t.id, { postResult: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    expect(getPost(`result:${t.id}`)).toBeNull();
  });

  it("is closed, unsent, for a stopped test nobody was paid on", async () => {
    const t = seedTest({ status: "cancelled" });
    setSharing(t.id, { postResult: true });
    const { sent, client } = fakeClient();
    await runXAgent(NOW, live(client));
    expect(sent).toEqual([]);
    expect(getPost(`result:${t.id}`)).toMatchObject({ status: "skipped", reason: "nobody was paid" });
  });
});
