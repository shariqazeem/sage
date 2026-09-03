import { describe, expect, it } from "vitest";
import { alertText, recipientsFor, type AlertableWork, type RosterMember } from "./alerts";

const NOW = 1_800_000_000;
const m = (over: Partial<RosterMember> = {}): RosterMember => ({
  walletKey: "a1", wallet: "0xA1", target: "100", mutedAt: null, lastNotifiedAt: null, ...over,
});
const work = (over: Partial<AlertableWork> = {}): AlertableWork => ({
  campaignId: "camp1", title: "Test the quickstart", openSlots: 5, rewardBase: 1_100_000, participants: [], ...over,
});

describe("who gets told about new work", () => {
  it("tells opted-in members about work that can still pay them", () => {
    expect(recipientsFor(work(), [m(), m({ walletKey: "b2", wallet: "0xB2" })], NOW).map((x) => x.walletKey)).toEqual(["a1", "b2"]);
  });

  it("never tells anyone about a campaign with nothing left to claim", () => {
    expect(recipientsFor(work({ openSlots: 0 }), [m()], NOW)).toEqual([]);
  });

  it("never tells someone about work they already did — a participant is not a lead", () => {
    expect(recipientsFor(work({ participants: ["0x00a1"] }), [m()], NOW)).toEqual([]);
  });

  it("respects the cooldown, so five launches in an hour are not five messages", () => {
    const recent = m({ lastNotifiedAt: NOW - 3600 });
    expect(recipientsFor(work(), [recent], NOW)).toEqual([]);
    expect(recipientsFor(work(), [recent], NOW + 20 * 3600)).toHaveLength(1);
  });

  it("never messages someone who asked to stop", () => {
    expect(recipientsFor(work(), [m({ mutedAt: NOW - 10 })], NOW)).toEqual([]);
  });

  it("matches a wallet by its minimal form, so a padded felt is the same person", () => {
    const padded = m({ wallet: `0x${"0".repeat(50)}a1` });
    expect(recipientsFor(work({ participants: ["0xa1"] }), [padded], NOW)).toEqual([]);
  });

  it("says only what the ledger supports, and how to leave", () => {
    const t = alertText(work({ openSlots: 1 }), "https://sagepays.xyz");
    expect(t).toContain("$1.10 each · 1 slot open");
    expect(t).toContain("https://sagepays.xyz/c/camp1");
    expect(t).toMatch(/Reply "stop"/);
  });
});
