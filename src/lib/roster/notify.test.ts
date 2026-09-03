import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The announcement touches real people, so the properties that matter are: once per campaign ever,
 * never to someone who already worked there, and never twice inside the cooldown.
 */
vi.mock("@/lib/telegram/bot", () => ({ sendTelegram: vi.fn(async () => true) }));

const { announceNewWork, alertableWork } = await import("./notify");
const { sendTelegram } = await import("@/lib/telegram/bot");
const { joinRoster, muteByChat, rosterSize } = await import("@/lib/db/roster");
const { seedV2Campaign } = await import("@/lib/campaigns/campaign-v2.fixture");
const { createSubmission } = await import("@/lib/db/campaigns");

const WORKER = `0x${"a".repeat(40)}`;

describe("telling the roster about new work", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    muteByChat("chat-1");
    muteByChat("chat-2");
  });

  it("tells an opted-in worker once, and never again for the same campaign", async () => {
    joinRoster(WORKER, "chat-1");
    seedV2Campaign({ wallet: `0x${"b".repeat(40)}` });
    const first = await announceNewWork();
    expect(first.sent).toBeGreaterThan(0);
    expect(vi.mocked(sendTelegram).mock.calls[0][0]).toBe("chat-1");
    expect(String(vi.mocked(sendTelegram).mock.calls[0][1])).toMatch(/New paid work/);
    vi.clearAllMocks();
    const second = await announceNewWork();
    expect(second.campaigns).toBe(0);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("never tells someone about a campaign they already submitted to", async () => {
    const f = seedV2Campaign({ wallet: `0x${"c".repeat(40)}` });
    const worker = `0x${"d".repeat(40)}`;
    createSubmission({ campaignId: f.campaign.id, wallet: worker, note: "I opened it and read the whole quickstart page carefully.", missionIdHash: f.mission.missionIdHash });
    joinRoster(worker, "chat-2");
    await announceNewWork();
    const targets = vi.mocked(sendTelegram).mock.calls.map((c) => c[0]);
    expect(targets).not.toContain("chat-2");
  });

  it("a muted row stays in the table but never receives anything", async () => {
    joinRoster(`0x${"e".repeat(40)}`, "chat-1");
    const before = rosterSize();
    muteByChat("chat-1");
    expect(rosterSize().total).toBe(before.total);
    expect(rosterSize().active).toBeLessThan(before.active + 1);
    seedV2Campaign({ wallet: `0x${"f".repeat(40)}` });
    vi.clearAllMocks();
    await announceNewWork();
    expect(vi.mocked(sendTelegram).mock.calls.map((c) => c[0])).not.toContain("chat-1");
  });

  it("THREE NEW CAMPAIGNS IN ONE SWEEP IS STILL ONE MESSAGE — the cooldown holds inside a run", async () => {
    joinRoster(`0x${"9".repeat(40)}`, "chat-1");
    seedV2Campaign({ wallet: `0x${"2".repeat(40)}` });
    seedV2Campaign({ wallet: `0x${"3".repeat(40)}` });
    seedV2Campaign({ wallet: `0x${"4".repeat(40)}` });
    vi.clearAllMocks();
    const r = await announceNewWork();
    expect(r.campaigns).toBeGreaterThanOrEqual(3);
    expect(vi.mocked(sendTelegram).mock.calls.filter((c) => c[0] === "chat-1")).toHaveLength(1);
  });

  it("counts only slots that can still be claimed and paid", () => {
    const f = seedV2Campaign({ wallet: `0x${"1".repeat(40)}` });
    const w = alertableWork(f.campaign);
    expect(w.openSlots).toBeGreaterThan(0);
    expect(w.campaignId).toBe(f.campaign.id);
  });
});
