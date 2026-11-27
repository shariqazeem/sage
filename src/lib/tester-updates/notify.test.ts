import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TESTERS HEAR WHAT HAPPENED, ON REAL ROWS: only people on the alerts roster, once per answer and kind,
 * and nothing from before the step first ran.
 */
vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { campaigns, decisions, missions as missionsTable, recipientWallets, testerNotices, workAlerts } from "@/lib/db/schema";
import { createSubmission, recordEvent, updateSubmission } from "@/lib/db/campaigns";
import { joinRoster, muteByChat } from "@/lib/db/roster";
import { BASELINE, notifyTesters } from "./notify";

// answers are stamped with the real clock when they arrive, so this file runs on it
const NOW = Math.floor(Date.now() / 1000) + 5;
const W = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
let n = 0;
/** a wallet no earlier test in this file used */
const w = (k: number) => W(n * 100 + k);

function test(): string {
  const id = `tu-${++n}`;
  db.insert(campaigns).values({
    id, title: "Tester test", rewardAmount: 1_000_000, vaultAddress: `0x${"e".repeat(40)}`, chainId: 1088,
    posterWallet: `0x${"b".repeat(40)}`, ownerIsSage: false, status: "live", autonomy: "autopilot", vaultKind: "campaign_v2",
    campaignIdHash: `0x${"c".repeat(64)}`, missionPlanDigest: `0x${"d".repeat(64)}`, commitmentVersion: 2, createdAt: NOW - 5000,
  }).run();
  db.insert(missionsTable).values({
    id: `${id}:m`, campaignId: id, missionKey: "m", missionIdHash: `0x${n.toString(16).padStart(64, "7")}`,
    title: "Try it", objective: "Try", instructions: "Try it", targetSurface: "https://demo.example/app", criteria: [], evidenceList: [],
    rewardAmount: 2_500_000, maxCompletions: 9, status: "active", displayOrder: 0, specDigest: `0x${"f".repeat(64)}`, lockedAt: 1, createdAt: 1, updatedAt: 1,
  }).run();
  return id;
}
function answer(id: string, wallet: string) {
  const r = createSubmission({ campaignId: id, wallet, note: "what I saw", missionIdHash: `0x${Number(id.split("-")[1]).toString(16).padStart(64, "7")}` });
  if (!r.ok) throw new Error(r.error);
  return r.submission;
}
const judged = (id: string, sid: string) => db.insert(decisions).values({ id: `d-${sid}`, submissionId: sid, campaignId: id, engine: "heuristic", brief: { reasonCode: "needs_review" } as never, createdAt: NOW }).run();
const sender = () => {
  const sent: { chat: string; text: string }[] = [];
  return { sent, send: async (chat: string, text: string) => (sent.push({ chat, text }), true) };
};
/** the first run has already happened: the past is settled */
const settled = () => db.insert(testerNotices).values({ submissionId: BASELINE.submissionId, kind: BASELINE.kind, sentAt: NOW - 9000 }).onConflictDoNothing().run();

beforeEach(() => {
  db.delete(testerNotices).run();
  db.delete(workAlerts).run();
  db.delete(recipientWallets).run();
});

describe("the sweep's step for testers", () => {
  it("on its first run marks the past as said and messages nobody", async () => {
    const id = test();
    joinRoster(w(1), "101", NOW - 4000);
    const a = answer(id, w(1));
    updateSubmission(a.id, { status: "paid", payoutTx: "0xold", decidedAt: NOW - 100 });
    const s = sender();
    expect(await notifyTesters(NOW, s)).toEqual({ sent: 0, failed: 0, baselined: 1 });
    expect(await notifyTesters(NOW + 300, s)).toEqual({ sent: 0, failed: 0, baselined: 0 });
    expect(s.sent).toEqual([]);
  });

  it("tells a tester on the roster they were paid, once, and never a tester who did not ask", async () => {
    settled();
    const id = test();
    joinRoster(w(1), "101", NOW - 4000);
    const mine = answer(id, w(1));
    const theirs = answer(id, w(2));
    updateSubmission(mine.id, { status: "paid", payoutTx: "0xaaa", decidedAt: NOW - 10 });
    updateSubmission(theirs.id, { status: "paid", payoutTx: "0xbbb", decidedAt: NOW - 10 });
    const s = sender();
    expect(await notifyTesters(NOW, s)).toEqual({ sent: 1, failed: 0, baselined: 0 });
    expect(s.sent).toEqual([{ chat: "101", text: "Sage paid you $2.50 for trying Tester test. Receipt: http://localhost:3000/proof/0xaaa" }]);
    await notifyTesters(NOW + 300, s);
    expect(s.sent).toHaveLength(1);
  });

  it("tells them it went to the builder, then what the builder said, in the words the page shows", async () => {
    settled();
    const id = test();
    joinRoster(w(1), "101", NOW - 4000);
    const a = answer(id, w(1));
    judged(id, a.id);
    const s = sender();
    await notifyTesters(NOW, s);
    expect(s.sent.map((m) => m.text)).toEqual(["Sage passed your answer on Tester test to its builder to read. You'll hear here when they decide."]);
    updateSubmission(a.id, { status: "rejected", rejectReason: "The builder said: you tried the old version", decidedAt: NOW + 60 });
    await notifyTesters(NOW + 300, s);
    expect(s.sent.at(-1)?.text).toBe("Your answer on Tester test was not paid: The builder said: you tried the old version.");
    expect(s.sent).toHaveLength(2);
  });

  it("tells them Sage needs more while attempts remain, and never hands that one to the builder line", async () => {
    settled();
    const id = test();
    joinRoster(w(1), "101", NOW - 4000);
    const a = answer(id, w(1));
    judged(id, a.id);
    recordEvent({ campaignId: id, submissionId: a.id, kind: "autopay_held", detail: "0x1 · Held for the tester to refine — attempt 1 of 3, no action needed yet (observation_retry)", createdAt: NOW - 5 });
    const s = sender();
    await notifyTesters(NOW, s);
    expect(s.sent).toEqual([
      { chat: "101", text: `Your answer on Tester test was not paid yet: Sage needs more of what you saw. You can improve it from the test page: http://localhost:3000/t/${id}` },
    ]);
  });

  it("says nothing about what happened before they joined, or after they said stop", async () => {
    settled();
    const id = test();
    const early = answer(id, w(1));
    updateSubmission(early.id, { status: "paid", payoutTx: "0xearly", decidedAt: NOW - 500 });
    joinRoster(w(1), "101", NOW - 100);
    joinRoster(w(3), "303", NOW - 4000);
    const muted = answer(id, w(3));
    updateSubmission(muted.id, { status: "paid", payoutTx: "0xmuted", decidedAt: NOW - 10 });
    muteByChat("303", NOW - 5);
    const s = sender();
    expect((await notifyTesters(NOW, s)).sent).toBe(0);
    expect(s.sent).toEqual([]);
  });

  it("does not tell a walletless tester twice: their payout already messages their chat", async () => {
    settled();
    const id = test();
    joinRoster(w(4), "404", NOW - 4000);
    db.insert(recipientWallets).values({ chatId: "404", privyWalletId: "pw", address: w(4), createdAt: 1 }).run();
    const a = answer(id, w(4));
    updateSubmission(a.id, { status: "paid", payoutTx: "0xw", decidedAt: NOW - 10 });
    expect((await notifyTesters(NOW, sender())).sent).toBe(0);
  });

  it("gives a notice back when Telegram did not take it", async () => {
    settled();
    const id = test();
    joinRoster(w(1), "101", NOW - 4000);
    const a = answer(id, w(1));
    updateSubmission(a.id, { status: "paid", payoutTx: "0xr", decidedAt: NOW - 10 });
    expect(await notifyTesters(NOW, { send: async () => false })).toEqual({ sent: 0, failed: 1, baselined: 0 });
    expect((await notifyTesters(NOW + 300, sender())).sent).toBe(1);
  });
});
