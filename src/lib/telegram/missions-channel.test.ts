import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { campaignSharing, channelPosts, missions } from "@/lib/db/schema";
import { createCampaign, createMission } from "@/lib/db/campaigns";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { setSharing } from "@/lib/sharing";
import { channelText, MAX_CHANNEL_POSTS_PER_TICK, postMissionsToChannel, type ChannelSend } from "./missions-channel";

/**
 * The channel of open tests: only with the builder's yes, once per test ever, on the record before it is
 * sent, and never for members-only or full work.
 */

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0) / 1000;
let n = 0;

function seedTest(opts: { places?: number; rewardBase?: number; visibility?: "listed" | "unlisted"; share?: boolean } = {}) {
  const reward = opts.rewardBase ?? 2_000_000;
  const c = createCampaign({
    title: `Acme Notes ${++n}`,
    rewardAmount: reward,
    vaultAddress: `0x${"3".repeat(40)}`,
    posterWallet: `0x${"4".repeat(40)}`,
    chainId: 1088,
    vaultKind: "campaign_v2",
    criteria: [],
    status: "live",
    visibility: opts.visibility ?? "listed",
  });
  createMission({
    campaignId: c.id,
    missionKey: "try",
    missionIdHash: missionIdHash(c.id, "try"),
    title: "Try it",
    rewardAmount: reward,
    maxCompletions: opts.places ?? 10,
    displayOrder: 0,
  });
  if (opts.share !== false) setSharing(c.id, { postMission: true }, NOW);
  return c.id;
}

function fakeSend(answer?: () => Awaited<ReturnType<ChannelSend>>) {
  const sent: { chatId: string; html: string; url: string }[] = [];
  const send: ChannelSend = async (chatId, html, button) => {
    sent.push({ chatId, html, url: button.url });
    return answer ? answer() : { ok: true, messageId: sent.length };
  };
  return { sent, send };
}

beforeEach(() => {
  db.delete(channelPosts).run();
  db.delete(campaignSharing).run();
  db.delete(missions).run();
});

describe("postMissionsToChannel", () => {
  it("does nothing until a channel is set up", async () => {
    seedTest();
    const { sent, send } = fakeSend();
    const r = await postMissionsToChannel(NOW, { chatId: null, send });
    expect(r.skipped).toBe("no channel set up");
    expect(sent).toHaveLength(0);
  });

  it("posts a shared test once, with a button to the test", async () => {
    const id = seedTest();
    const { sent, send } = fakeSend();
    const first = await postMissionsToChannel(NOW, { chatId: "@sagetests", send });
    const again = await postMissionsToChannel(NOW + 300, { chatId: "@sagetests", send });
    const mine = sent.filter((s) => s.url.endsWith(`/t/${id}?via=tg`));
    expect(mine).toHaveLength(1);
    expect(first.posted).toBeGreaterThanOrEqual(1);
    expect(again.posted).toBe(0);
    expect(mine[0].html).toContain("10 places · $2 each · paid in USDC on Metis");
  });

  it("never posts without the builder's yes, or members-only work", async () => {
    const quiet = seedTest({ share: false });
    const unlisted = seedTest({ visibility: "unlisted" });
    const { sent, send } = fakeSend();
    await postMissionsToChannel(NOW, { chatId: "@sagetests", send });
    expect(sent.some((s) => s.url.includes(`/t/${quiet}`) || s.url.includes(`/t/${unlisted}`))).toBe(false);
  });

  it("records a failure and tries it again on a later tick", async () => {
    const id = seedTest();
    let fail = true;
    const { sent, send } = fakeSend(() => (fail ? { ok: false, detail: "bot is not an admin" } : { ok: true, messageId: 7 }));
    const r1 = await postMissionsToChannel(NOW, { chatId: "@sagetests", send });
    expect(r1.failed).toBeGreaterThanOrEqual(1);
    fail = false;
    await postMissionsToChannel(NOW + 300, { chatId: "@sagetests", send });
    expect(sent.filter((s) => s.url.endsWith(`/t/${id}?via=tg`))).toHaveLength(2);
  });

  it("never resends a row that may already have reached Telegram", async () => {
    const id = seedTest();
    db.insert(channelPosts).values({ subjectKey: `mission:${id}`, chatId: "@sagetests", status: "drafted", createdAt: NOW }).run();
    const { sent, send } = fakeSend();
    await postMissionsToChannel(NOW, { chatId: "@sagetests", send });
    expect(sent.some((s) => s.url.endsWith(`/t/${id}?via=tg`))).toBe(false);
  });

  it("posts at most three a tick", async () => {
    for (let i = 0; i < MAX_CHANNEL_POSTS_PER_TICK + 2; i++) seedTest();
    const { sent, send } = fakeSend();
    await postMissionsToChannel(NOW, { chatId: "@sagetests", send });
    expect(sent.length).toBeLessThanOrEqual(MAX_CHANNEL_POSTS_PER_TICK);
  });
});

describe("channelText", () => {
  it("escapes the product name and states a range when rewards differ", () => {
    const t = channelText({ product: "<b>evil</b> & co", places: 1, rewardMinBase: 1_000_000, rewardMaxBase: 2_500_000 });
    expect(t).toContain("&lt;b&gt;evil&lt;/b&gt; &amp; co");
    expect(t).toContain("1 place · $1–$2.50 each");
  });
});
