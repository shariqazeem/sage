import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SEE EVERYTHING, END TO END ON REAL ROWS: the beacon writes a visit, the owner's view of the test carries
 * the funnel, the sources, each person's journey and their words, and the public view carries none of it.
 */
const h = vi.hoisted(() => ({ me: null as string | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, decisions, events, missions as missionsTable, submissions, testVisits } from "@/lib/db/schema";
import { createSubmission, getCampaign, recordEvent, updateSubmission } from "@/lib/db/campaigns";
import { setCoreAnswer } from "@/lib/core-test/answers";
import { listVisits, recordVisit, visitorId, VISIT_WRITE_GAP_SEC } from "@/lib/db/test-visits";
import { bindChannel } from "@/lib/builder-updates/store";
import { POST as seen } from "@/app/api/t/[id]/seen/route";
import { liveView } from "./live";
import { heldForBuilder } from "./tracking";

const OWNER = `0x${"b".repeat(40)}`;
const T1 = `0x${"1".repeat(40)}`;
const T2 = `0x${"2".repeat(40)}`;
const T3 = `0x${"3".repeat(40)}`;
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MID = `0x${"a".repeat(64)}`;
let n = 0;

function test(status: "live" | "draft" = "live"): string {
  const id = `track-${++n}`;
  db.insert(campaigns).values({
    id, title: "Tracked test", rewardAmount: 2_000_000, vaultAddress: `0x${"e".repeat(40)}`, chainId: 1088,
    posterWallet: OWNER, ownerIsSage: false, status, autonomy: "autopilot", vaultKind: "campaign_v2",
    campaignIdHash: `0x${"c".repeat(64)}`, missionPlanDigest: `0x${"d".repeat(64)}`, commitmentVersion: 2, createdAt: 1000,
  }).run();
  db.insert(missionsTable).values({
    id: `${id}:m`, campaignId: id, missionKey: "m", missionIdHash: `${MID.slice(0, 60)}${n.toString(16).padStart(6, "0")}`,
    title: "Try it", objective: "Try the product", instructions: "Try it and say what happened", targetSurface: "https://demo.example/app",
    criteria: [], evidenceList: [], rewardAmount: 2_000_000, maxCompletions: 5, status: "active", displayOrder: 0,
    specDigest: `0x${"f".repeat(64)}`, lockedAt: 1000, createdAt: 1000, updatedAt: 1000,
  }).run();
  return id;
}
const missionOf = (id: string) => db.select().from(missionsTable).where(eq(missionsTable.campaignId, id)).get()!.missionIdHash;

function answer(id: string, wallet: string, note: string) {
  const r = createSubmission({ campaignId: id, wallet, note, missionIdHash: missionOf(id) });
  if (!r.ok) throw new Error(r.error);
  return r.submission;
}
function judged(id: string, submissionId: string) {
  db.insert(decisions).values({ id: `d-${submissionId}`, submissionId, campaignId: id, engine: "heuristic", brief: { reasonCode: "needs_review" } as never, createdAt: 2000 }).run();
}

const beacon = (id: string, body: unknown, opts: { cookie?: string; ua?: string | null } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.ua !== null) headers["user-agent"] = opts.ua ?? BROWSER;
  if (opts.cookie) headers.cookie = `sg_v=${opts.cookie}`;
  return seen(new NextRequest(`https://sagepays.xyz/api/t/${id}/seen`, { method: "POST", body: JSON.stringify(body), headers }), { params: Promise.resolve({ id }) });
};
const cookieOf = (res: Response): string | null => /sg_v=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;

beforeEach(() => {
  h.me = null;
});

describe("a visit row", () => {
  it("keeps the first source for ever, and the first sign-in and first open once each", () => {
    const id = test();
    const v = visitorId("cookie-a");
    expect(recordVisit({ campaignId: id, visitor: v, source: "x", wallet: null, step: "view", now: 5000 })).toBe(true);
    // inside the gap a second view writes nothing
    expect(recordVisit({ campaignId: id, visitor: v, source: "telegram", wallet: null, step: "view", now: 5000 + VISIT_WRITE_GAP_SEC - 1 })).toBe(false);
    // ...but a first sign-in and a first click through to the product are kept even inside it
    expect(recordVisit({ campaignId: id, visitor: v, source: "telegram", wallet: T1.toUpperCase().replace("0X", "0x"), step: "view", now: 5010 })).toBe(true);
    expect(recordVisit({ campaignId: id, visitor: v, source: "earn", wallet: T1, step: "opened", now: 5020 })).toBe(true);
    expect(recordVisit({ campaignId: id, visitor: v, source: "earn", wallet: T1, step: "opened", now: 5025 })).toBe(false);
    expect(recordVisit({ campaignId: id, visitor: v, source: "earn", wallet: T1, step: "view", now: 5020 + VISIT_WRITE_GAP_SEC })).toBe(true);
    expect(listVisits(id)).toEqual([{ campaignId: id, visitor: v, source: "x", wallet: T1, firstAt: 5000, lastAt: 5020 + VISIT_WRITE_GAP_SEC, views: 2, signedInAt: 5010, openedAt: 5020 }]);
  });

  it("stores a hash of the cookie, never the cookie", () => {
    expect(visitorId("cookie-a")).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorId("cookie-a")).not.toContain("cookie");
    expect(visitorId("cookie-a")).not.toBe(visitorId("cookie-b"));
  });
});

describe("POST /api/t/[id]/seen", () => {
  it("sets the cookie once and records the visit with its source", async () => {
    const id = test();
    const first = await beacon(id, { via: "x", ref: "https://t.me/whatever" });
    expect(first.status).toBe(204);
    const cookie = cookieOf(first);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(first.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    const rows = listVisits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "x", wallet: null, views: 1, signedInAt: null, openedAt: null });
    expect(rows[0].visitor).toBe(visitorId(cookie!));

    // the same visitor, now signed in, opens the product: one row, the first source kept, no new cookie
    h.me = T1;
    const again = await beacon(id, { step: "opened", via: "earn" }, { cookie: cookie! });
    expect(cookieOf(again)).toBeNull();
    const after = listVisits(id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ source: "x", wallet: T1 });
    expect(after[0].signedInAt).not.toBeNull();
    expect(after[0].openedAt).not.toBeNull();
  });

  it("reads the referring page when the link carries no word", async () => {
    const id = test();
    await beacon(id, { ref: "https://sagepays.xyz/earn" });
    await beacon(id, {});
    expect(listVisits(id).map((r) => r.source).sort()).toEqual(["direct", "earn"]);
  });

  it("writes nothing for a bot, the test's own builder, a draft or a test that does not exist", async () => {
    const id = test();
    expect((await beacon(id, {}, { ua: "Twitterbot/1.0" })).status).toBe(204);
    expect((await beacon(id, {}, { ua: null })).status).toBe(204);
    h.me = OWNER;
    const mine = await beacon(id, {});
    expect(mine.status).toBe(204);
    expect(cookieOf(mine)).toBeNull();
    h.me = null;
    const draft = test("draft");
    expect((await beacon(draft, {})).status).toBe(204);
    expect((await beacon("no-such-test", {})).status).toBe(204);
    expect(listVisits(id)).toEqual([]);
    expect(listVisits(draft)).toEqual([]);
    expect(db.select().from(testVisits).where(eq(testVisits.campaignId, "no-such-test")).all()).toEqual([]);
  });

  it("keeps no IP address and no user agent: the table has no column for either", () => {
    const columns = db.all<{ name: string }>(sql`PRAGMA table_info(test_visits)`).map((c) => c.name);
    expect(columns.sort()).toEqual(["campaign_id", "first_at", "last_at", "opened_at", "signed_in_at", "source", "views", "visitor", "wallet"]);
  });
});

describe("the owner's view of a test", () => {
  function seeded() {
    const id = test();
    // a stranger who only looked, from X
    recordVisit({ campaignId: id, visitor: "v-looker", source: "x", wallet: null, step: "view", now: 5000 });
    // T1 came from Earn, signed in, opened the product, answered and was paid
    recordVisit({ campaignId: id, visitor: "v-t1", source: "earn", wallet: T1, step: "view", now: 5100 });
    recordVisit({ campaignId: id, visitor: "v-t1", source: "earn", wallet: T1, step: "opened", now: 5200 });
    const paid = answer(id, T1, "I signed up and the code never arrived.");
    updateSubmission(paid.id, { status: "paid", payoutTx: "0xpaid", decidedAt: 6000 });
    recordEvent({ campaignId: id, submissionId: paid.id, kind: "autopay_settled", detail: "0x1111…1111 · 91% · dec d", txHash: "0xpaid", amount: 2_000_000, createdAt: 6000 });
    setCoreAnswer({ submissionId: paid.id, campaignId: id, reached: "started", again: "maybe" });
    // T2 answered with no visit on record, and Sage held the answer for the builder
    const held = answer(id, T2, "It looks like a donation site.");
    judged(id, held.id);
    recordEvent({ campaignId: id, submissionId: held.id, kind: "autopay_held", detail: JSON.stringify({ t: "0x2222…2222 · It names nothing Sage saw behind the first screen (no_sign_of_a_try)", cid: "c1" }), createdAt: 6100 });
    // T3 answered and has not been read yet
    const fresh = answer(id, T3, "Just arrived.");
    return { id, paid, held, fresh };
  }

  it("carries the funnel, the sources, what Sage did and where updates go", () => {
    const { id } = seeded();
    const view = liveView(getCampaign(id)!, OWNER);
    expect(view.viewer).toBe("owner");
    const o = view.owner!;
    expect(o.funnel.stages.map((s) => [s.stage, s.people])).toEqual([["saw", 4], ["signed-in", 3], ["opened", 3], ["answered", 3], ["paid", 1]]);
    expect(o.funnel.tracked).toBe(true);
    expect(o.funnel.held).toBe(1);
    expect(o.funnel.notPaid).toBe(0);
    expect(o.funnel.stop).toEqual({ after: "saw", people: 1, line: "Most people who stopped did so after seeing the test: 4 saw it, 3 signed in." });
    expect(o.sources).toEqual([
      { source: "direct", label: "Direct or unknown", saw: 2, answered: 2, paid: 0 },
      { source: "earn", label: "Earn, Sage's list of open tests", saw: 1, answered: 1, paid: 1 },
      { source: "x", label: "Sage's post on X", saw: 1, answered: 0, paid: 0 },
    ]);
    expect(o.updates).toEqual({ telegram: "off", email: "unavailable", emailTo: null });
    bindChannel(OWNER, "777");
    expect(liveView(getCampaign(id)!, OWNER).owner!.updates).toMatchObject({ telegram: "connected" });

    const said = o.activity.map((a) => a.kind);
    expect(said).toContain("paid");
    expect(said).toContain("held");
    expect(said).toContain("opened");
    expect(o.activity.find((a) => a.kind === "paid")).toMatchObject({ text: "Sage checked 0x1111…1111's answer and paid $2.00.", href: "/proof/0xpaid" });
    expect(o.activity.find((a) => a.kind === "held")?.text).toBe("Sage held 0x2222…2222's answer for you: It names nothing Sage saw behind the first screen.");
    expect(o.activity.find((a) => a.kind === "opened")?.text).toBe("The test opened: $10.00 for 5 places, held in its own vault on Metis.");
  });

  it("gives each ticket its journey, the tester's own words, and the hold that waits for the builder", () => {
    const { id, paid, held, fresh } = seeded();
    const tickets = new Map(liveView(getCampaign(id)!, OWNER).tickets.map((t) => [t.key, t]));
    const p = tickets.get(paid.id)!;
    expect(p.answer).toBe("I signed up and the code never arrived.");
    expect(p.journey).toEqual({
      source: "earn", sawAt: 5100, signedInAt: 5100, openedAt: 5200, answeredAt: paid.createdAt, decidedAt: 6000, paidAt: 6000,
      stoppedAt: "Started, couldn't finish", wouldReturn: "Maybe",
    });
    expect(p.held).toBeUndefined();

    const hd = tickets.get(held.id)!;
    expect(hd.held?.submissionId).toBe(held.id);
    expect(hd.held?.why).toBeTruthy();
    expect(hd.journey).toMatchObject({ source: "direct", sawAt: null, openedAt: null, paidAt: null, stoppedAt: null, wouldReturn: null });

    // an answer Sage has not read yet is not the builder's to decide
    expect(tickets.get(fresh.id)!.held).toBeUndefined();
    expect(heldForBuilder(getCampaign(id)!).has(fresh.id)).toBe(false);
  });

  it("does not hand the builder an answer the tester may still add to", () => {
    const id = test();
    const s = answer(id, T1, "Thin first try.");
    judged(id, s.id);
    recordEvent({ campaignId: id, submissionId: s.id, kind: "autopay_held", detail: "0x1111…1111 · Held for the tester to refine — attempt 1 of 3, no action needed yet (observation_retry)" });
    expect(heldForBuilder(getCampaign(id)!).size).toBe(0);
  });

  it("NO CORPUS ORACLE: the public view has no answers, no journeys, no holds and no owner block", () => {
    const { id } = seeded();
    for (const viewer of [null, T1, T3]) {
      const view = liveView(getCampaign(id)!, viewer);
      expect(view.viewer).toBe("public");
      expect(view.owner).toBeNull();
      for (const t of view.tickets) {
        expect(t).not.toHaveProperty("answer");
        expect(t).not.toHaveProperty("journey");
        expect(t).not.toHaveProperty("held");
      }
      const json = JSON.stringify(view);
      expect(json).not.toContain("the code never arrived");
      expect(json).not.toContain("donation site");
      expect(json).not.toMatch(/funnel|sources|activity|journey/);
    }
  });

  it("says visits were not counted on a test that predates tracking", () => {
    const id = test();
    const s = answer(id, T1, "An answer from before.");
    updateSubmission(s.id, { status: "paid", payoutTx: "0xold", decidedAt: 3000 });
    const o = liveView(getCampaign(id)!, OWNER).owner!;
    expect(o.funnel.tracked).toBe(false);
    expect(o.funnel.stages.map((x) => x.people)).toEqual([1, 1, 1, 1, 1]);
  });
});

// keep the unused-table imports honest: every table this file seeds is one the view reads
void [events, submissions];
