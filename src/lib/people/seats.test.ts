import { describe, expect, it } from "vitest";
import { createCampaign, createMission, getCampaign, setCampaignStatus } from "@/lib/db/campaigns";
import { db } from "@/lib/db";
import { jobLinks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkSubmitDoor } from "@/lib/campaigns/submit-door";
import { claimSeat, getJobLink, isSeatCode, linkFor, seatHolders, seatMessage, seatsForCampaign, seatsTaken } from "./seats";

/**
 * PEOPLE: A JOB'S OWN LINK FOR N PEOPLE, ON EVERY PLAN (seats.ts, 6 Nov 2026).
 *
 * Measured the same day: every job a founder made for "my people" launched into silence (members-only
 * work had no door on Free, and the named list it could have used had no way in). These hold the bargain:
 * one link, N places, one place per person; a place puts the person on the job's named list and nothing
 * else; a closed job admits nobody.
 */

let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(40, "a")}`;

function job(slots = 3, over: { visibility?: "listed" | "unlisted" } = { visibility: "unlisted" }) {
  const c = createCampaign({
    title: `seat-job-${++n}`,
    rewardAmount: 2_000_000,
    vaultAddress: `0x${"9".repeat(40)}`,
    posterWallet: `0x${"8".repeat(40)}`,
    chainId: 1088,
    status: "live",
    ...(over.visibility ? { visibility: over.visibility } : {}),
  });
  createMission({
    campaignId: c.id,
    missionKey: `m-${n}`,
    missionIdHash: `0x${n.toString(16).padStart(64, "0")}`,
    title: "Write a thread about Metis",
    goal: "A thread",
    instructions: "Post it",
    acceptanceCriteria: [],
    evidenceList: [],
    rewardAmount: 2_000_000,
    maxCompletions: slots,
    status: "active",
    displayOrder: 0,
  } as Parameters<typeof createMission>[0]);
  return getCampaign(c.id)!;
}

describe("the link", () => {
  it("is one link per job: asking twice returns the same code, with the job's places", () => {
    const c = job(40);
    const a = linkFor({ campaignId: c.id }, c.posterWallet, seatsForCampaign(c.id));
    const b = linkFor({ campaignId: c.id }, c.posterWallet, 99);
    expect(a.code).toBe(b.code);
    expect(a.seats).toBe(40);
    expect(isSeatCode(a.code)).toBe(true);
  });

  it("only ever reads a seat-shaped code", () => {
    expect(getJobLink("inv_abc")).toBeNull();
    expect(getJobLink("seat_../../etc")).toBeNull();
  });
});

describe("taking a place", () => {
  it("puts the person on the job's named list, once", () => {
    const c = job(3);
    const { code } = linkFor({ campaignId: c.id }, c.posterWallet, 3);
    const w = wallet();
    const first = claimSeat(code, w);
    const again = claimSeat(code, w.toUpperCase().replace("0X", "0x"));
    expect(first).toMatchObject({ ok: true, already: false, seatsLeft: 2 });
    expect(again).toMatchObject({ ok: true, already: true });
    expect(getCampaign(c.id)!.allowlist).toEqual([w.toLowerCase()]);
    expect(seatsTaken(code)).toBe(1);
    expect(seatHolders(c.id)).toEqual([w.toLowerCase()]);
  });

  it("never admits more people than the job has places", () => {
    const c = job(2);
    const { code } = linkFor({ campaignId: c.id }, c.posterWallet, 2);
    expect(claimSeat(code, wallet()).ok).toBe(true);
    expect(claimSeat(code, wallet()).ok).toBe(true);
    const third = claimSeat(code, wallet());
    expect(third).toMatchObject({ ok: false, reason: "full" });
    expect(getCampaign(c.id)!.allowlist).toHaveLength(2);
  });

  it("refuses an address the job can't pay, a turned-off link and a closed job", () => {
    const c = job(5);
    const { code } = linkFor({ campaignId: c.id }, c.posterWallet, 5);
    expect(claimSeat(code, "0x" + "1".repeat(63))).toMatchObject({ ok: false, reason: "not_evm" });
    db.update(jobLinks).set({ revokedAt: 1 }).where(eq(jobLinks.code, code)).run();
    expect(claimSeat(code, wallet())).toMatchObject({ ok: false, reason: "revoked" });

    const d = job(5);
    const l2 = linkFor({ campaignId: d.id }, d.posterWallet, 5);
    setCampaignStatus(d.id, "cancelled");
    expect(claimSeat(l2.code, wallet())).toMatchObject({ ok: false, reason: "ended" });
  });

  it("a programme's link admits to the round open now, and holds the place between rounds", () => {
    const c = job(4);
    const { code } = linkFor({ programmeId: "prg_test_seats" }, c.posterWallet, 4);
    const w1 = wallet();
    const between = claimSeat(code, w1, { currentCampaign: () => ({ campaignId: null, ended: false }) });
    expect(between).toMatchObject({ ok: true, campaignId: null });
    expect(seatHolders("prg_test_seats")).toEqual([w1.toLowerCase()]);
    const w2 = wallet();
    const during = claimSeat(code, w2, { currentCampaign: () => ({ campaignId: c.id, ended: false }) });
    expect(during).toMatchObject({ ok: true, campaignId: c.id });
    expect(getCampaign(c.id)!.allowlist).toEqual([w2.toLowerCase()]);
    expect(claimSeat(code, wallet(), { currentCampaign: () => ({ campaignId: null, ended: true }) })).toMatchObject({ ok: false, reason: "ended" });
  });
});

describe("public work stays public", () => {
  it("a place never turns a public job into a named list that locks everyone else out", () => {
    const c = job(3, { visibility: "listed" });
    const { code } = linkFor({ campaignId: c.id }, c.posterWallet, 3);
    expect(claimSeat(code, wallet()).ok).toBe(true);
    expect(getCampaign(c.id)!.allowlist ?? []).toEqual([]);
  });
});

describe("the door a place opens", () => {
  it("a person with a place passes the submit door of unlisted work; a stranger does not", () => {
    const c = job(3, { visibility: "unlisted" });
    const { code } = linkFor({ campaignId: c.id }, c.posterWallet, 3);
    const seated = wallet();
    claimSeat(code, seated);
    const fresh = getCampaign(c.id)!;
    expect(checkSubmitDoor(fresh, seated, { surface: "web" }).ok).toBe(true);
    expect(checkSubmitDoor(fresh, wallet(), { surface: "web" }).ok).toBe(false);
  });
});

describe("the message the founder sends", () => {
  it("says what it pays, from the job itself, and ends with the link", () => {
    const m = seatMessage({ title: "Write a thread about Metis", rewardUsd: 5, url: "https://sagepays.xyz/join/seat_x", everyWeek: true });
    expect(m).toContain("$5 in USDC every week");
    expect(m.endsWith("https://sagepays.xyz/join/seat_x")).toBe(true);
    expect(seatMessage({ title: "t", rewardUsd: 2.5, url: "u" })).toContain("$2.50 in USDC for this");
  });
});
