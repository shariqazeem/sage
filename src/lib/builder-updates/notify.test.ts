import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUILDER UPDATES ON REAL ROWS: the link binds one chat to one builder, each notice is one message, a
 * builder who has not asked hears nothing, and what was already true when they connected is not news.
 */
vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { agentWallets, builderChannels, builderNotices, campaigns, decisions, missions as missionsTable } from "@/lib/db/schema";
import { createSubmission, getCampaign, updateSubmission } from "@/lib/db/campaigns";
import { redeemAlertToken } from "@/lib/db/roster";
import { builderUpdatesState, channelOf, mintUpdatesToken, muteChannel, noticesSent, redeemUpdatesToken } from "./store";
import { builderOf, notifyBuilders, settleBaseline } from "./notify";

const OWNER = `0x${"B".repeat(40)}`;
const NOW = 1_800_000_000;
let n = 0;

function test(over: { poster?: string; status?: string; createdAt?: number; kind?: "testing" | "gig" } = {}): string {
  const id = `bu-${++n}`;
  db.insert(campaigns).values({
    id, title: "Builder test", rewardAmount: 2_000_000, vaultAddress: `0x${"e".repeat(40)}`, chainId: 1088,
    posterWallet: over.poster ?? OWNER, ownerIsSage: false, status: over.status ?? "live", autonomy: "autopilot", vaultKind: "campaign_v2",
    kind: over.kind ?? "testing", campaignIdHash: `0x${"c".repeat(64)}`, missionPlanDigest: `0x${"d".repeat(64)}`, commitmentVersion: 2, createdAt: over.createdAt ?? NOW - 600,
  }).run();
  db.insert(missionsTable).values({
    id: `${id}:m`, campaignId: id, missionKey: "m", missionIdHash: `0x${n.toString(16).padStart(64, "0")}`,
    title: "Try it", objective: "Try the product", instructions: "Try it", targetSurface: "https://demo.example/app",
    criteria: [], evidenceList: [], rewardAmount: 2_000_000, maxCompletions: 2, status: "active", displayOrder: 0,
    specDigest: `0x${"f".repeat(64)}`, lockedAt: 1, createdAt: 1, updatedAt: 1,
  }).run();
  return id;
}
function answer(id: string, wallet: string) {
  const r = createSubmission({ campaignId: id, wallet, note: "my answer", missionIdHash: `0x${Number(id.split("-")[1]).toString(16).padStart(64, "0")}` });
  if (!r.ok) throw new Error(r.error);
  return r.submission;
}
const W = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
const sender = () => {
  const sent: { chat: string; text: string }[] = [];
  return { sent, send: async (chat: string, text: string) => (sent.push({ chat, text }), true) };
};

beforeEach(() => {
  db.delete(builderNotices).run();
  db.delete(builderChannels).run();
  db.delete(decisions).run();
  db.update(campaigns).set({ status: "draft" }).run(); // earlier tests' rows are out of scope
});

describe("the link", () => {
  it("binds the chat that opens it to the builder, once, and only as a builder link", () => {
    expect(builderUpdatesState(OWNER)).toBe("off");
    const token = mintUpdatesToken(OWNER, NOW);
    expect(token).toMatch(/^bu_[A-Za-z0-9_-]{16}$/);
    expect(redeemUpdatesToken(token, "555", NOW + 60)).toEqual({ ok: true, founderKey: OWNER.toLowerCase() });
    expect(channelOf(OWNER.toLowerCase())?.target).toBe("555");
    expect(builderUpdatesState(OWNER)).toBe("connected");
    expect(redeemUpdatesToken(token, "666", NOW + 61)).toMatchObject({ ok: false });
    expect(channelOf(OWNER)?.target).toBe("555");
  });

  it("expires after fifteen minutes, and refuses a link of another kind", () => {
    const token = mintUpdatesToken(OWNER, NOW);
    expect(redeemUpdatesToken(token, "555", NOW + 15 * 60 + 1)).toMatchObject({ ok: false });
    expect(redeemUpdatesToken("al_notmine", "555", NOW)).toEqual({ ok: false, reason: "That link isn't valid." });
    expect(redeemUpdatesToken("bu_nosuchtoken", "555", NOW)).toEqual({ ok: false, reason: "That link isn't valid." });
    expect(builderUpdatesState(OWNER)).toBe("off");
  });

  it("muting keeps the row, and a fresh link starts the messages again", () => {
    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    expect(muteChannel(OWNER, NOW + 5)).toBe(true);
    expect(builderUpdatesState(OWNER)).toBe("muted");
    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW + 10), "777", NOW + 10);
    expect(builderUpdatesState(OWNER)).toBe("connected");
    expect(channelOf(OWNER)?.target).toBe("777");
    expect(muteChannel(W(999))).toBe(false);
  });

  it("is never a way onto the work-alert roster", () => {
    const token = mintUpdatesToken(OWNER, NOW);
    // the roster's own redeemer would join the roster with it; the webhook routes by prefix, and this holds the prefix
    expect(token.startsWith("al_")).toBe(false);
    expect(redeemAlertToken("al_missing", "1", NOW)).toMatchObject({ ok: false });
  });
});

describe("the sweep's step", () => {
  it("tells a connected builder about a first answer once, and nobody who did not ask", async () => {
    const id = test();
    answer(id, W(1));
    const quiet = sender();
    expect(await notifyBuilders(NOW, quiet)).toEqual({ tests: 0, sent: 0, failed: 0 });
    expect(quiet.sent).toEqual([]);

    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    const s = sender();
    expect(await notifyBuilders(NOW, s)).toEqual({ tests: 1, sent: 1, failed: 0 });
    expect(s.sent).toEqual([{ chat: "555", text: `The first answer to your test of Builder test is in.\nhttp://localhost:3000/t/${id}#people` }]);
    expect(await notifyBuilders(NOW + 300, s)).toEqual({ tests: 0, sent: 0, failed: 0 });
    expect(s.sent).toHaveLength(1);
    expect([...noticesSent(id)]).toEqual(["first-answer"]);
  });

  it("tells an answer that waits for the builder, and the end with the people paid", async () => {
    const id = test();
    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    const a = answer(id, W(1));
    db.insert(decisions).values({ id: `d-${a.id}`, submissionId: a.id, campaignId: id, engine: "heuristic", brief: { reasonCode: "needs_review" } as never, createdAt: NOW }).run();
    const s = sender();
    await notifyBuilders(NOW, s);
    expect(s.sent.map((m) => m.text.split("\n")[0])).toEqual([
      "The first answer to your test of Builder test is in.",
      expect.stringMatching(/^An answer to your test of Builder test is waiting for you\..* Read it and decide whether it is paid\.$/),
    ]);
    // both places paid: the test is done
    updateSubmission(a.id, { status: "paid", payoutTx: "0x1", decidedAt: NOW + 10 });
    const b = answer(id, W(2));
    updateSubmission(b.id, { status: "paid", payoutTx: "0x2", decidedAt: NOW + 20 });
    await notifyBuilders(NOW + 300, s);
    expect(s.sent.at(-1)?.text).toBe(`Your test of Builder test has ended: 2 of 2 people paid. What they found is here.\nhttp://localhost:3000/t/${id}#findings`);
    await notifyBuilders(NOW + 600, s);
    expect(s.sent).toHaveLength(3);
  });

  it("tells a quiet first day, once", async () => {
    const id = test({ createdAt: NOW - 25 * 3600 });
    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    const s = sender();
    await notifyBuilders(NOW, s);
    await notifyBuilders(NOW + 300, s);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].text).toContain("has been open for a day and nobody has answered yet. Sage listed it on Earn. Sharing your own link fills it faster.");
    expect(s.sent[0].text.endsWith(`/t/${id}`)).toBe(true);
  });

  it("is silent for a muted builder, a draft, a gig, and a test whose founder Telegram already messages", async () => {
    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    answer(test({ status: "draft" }), W(1));
    answer(test({ kind: "gig" }), W(2));
    // a chat-launched test: its vault owner is the chat's own wallet, and that chat is already told
    const chatWallet = `0x${"7".repeat(40)}`;
    db.insert(agentWallets).values({ chatId: "4242", privyWalletId: "pw", privyWalletAddress: chatWallet, founderAddress: OWNER.toLowerCase(), policyId: "p", perCampaignCapBase: 1, createdAt: 1, updatedAt: 1 }).run();
    const chatTest = test({ poster: chatWallet });
    answer(chatTest, W(3));
    expect(builderOf(getCampaign(chatTest)!)).toBe(OWNER.toLowerCase());
    const s = sender();
    expect((await notifyBuilders(NOW, s)).sent).toBe(0);

    const mine = test();
    answer(mine, W(4));
    muteChannel(OWNER, NOW);
    expect((await notifyBuilders(NOW, s)).sent).toBe(0);
    expect(s.sent).toEqual([]);
  });

  it("gives a notice back when Telegram did not take it, so the next sweep tries again", async () => {
    const id = test();
    answer(id, W(1));
    redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    expect(await notifyBuilders(NOW, { send: async () => false })).toEqual({ tests: 1, sent: 0, failed: 1 });
    expect(noticesSent(id).size).toBe(0);
    const s = sender();
    expect((await notifyBuilders(NOW + 300, s)).sent).toBe(1);
  });

  it("what is already true when a builder connects is not news; a waiting answer still is", async () => {
    const id = test({ createdAt: NOW - 30 * 3600 });
    const a = answer(id, W(1));
    db.insert(decisions).values({ id: `d-${a.id}`, submissionId: a.id, campaignId: id, engine: "heuristic", brief: { reasonCode: "needs_review" } as never, createdAt: NOW }).run();
    const r = redeemUpdatesToken(mintUpdatesToken(OWNER, NOW), "555", NOW);
    if (!r.ok) throw new Error("not bound");
    expect(settleBaseline(r.founderKey, NOW)).toBe(1);
    expect([...noticesSent(id)]).toEqual(["first-answer"]);
    const s = sender();
    await notifyBuilders(NOW, s);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].text).toContain("is waiting for you");
  });
});
