import { describe, expect, it } from "vitest";

import {
  createRecipientInvite,
  getRecipientWallet,
  listInvitedCampaignIds,
  redeemRecipientInvite,
  saveRecipientWallet,
} from "./recipient-wallets";
import { appendToAllowlist, createCampaign, getCampaign } from "./campaigns";
import { handleRecipientStart } from "@/lib/telegram/recipient-onboarding";
import { db } from "@/lib/db";
import { campaigns } from "./schema";
import { eq } from "drizzle-orm";

/**
 * WALLETLESS RECIPIENT state — write-once invites, idempotent binds, and the rule that keeps the
 * board honest: redeeming an invite NEVER converts an OPEN campaign to invite-only (appending the
 * first wallet to an empty allowlist would lock everyone else out).
 */

let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(40, "c")}`;
function campaign(over: { allowlist?: string[] } = {}) {
  const c = createCampaign({
    title: `rcp-camp-${++n}`,
    rewardAmount: 1_000_000,
    vaultAddress: `0x${"9".repeat(40)}`,
    posterWallet: `0x${"8".repeat(40)}`,
    chainId: 2345,
    status: "live",
  });
  if (over.allowlist) db.update(campaigns).set({ allowlist: over.allowlist }).where(eq(campaigns.id, c.id)).run();
  return getCampaign(c.id)!;
}

describe("recipient invites — write-once, race-safe, idempotent for the winner", () => {
  it("first chat binds; same chat re-taps idempotently; another chat is refused", () => {
    const c = campaign();
    const inv = createRecipientInvite(c.id, c.posterWallet);
    const w = wallet();
    expect(redeemRecipientInvite(inv.code, "chatA", w)).toMatchObject({ ok: true, already: false });
    expect(redeemRecipientInvite(inv.code, "chatA", w)).toMatchObject({ ok: true, already: true });
    expect(redeemRecipientInvite(inv.code, "chatB", wallet())).toMatchObject({ ok: false, reason: "claimed_by_other" });
    expect(redeemRecipientInvite("rcp_nope", "chatC", wallet())).toMatchObject({ ok: false, reason: "not_found" });
    expect(listInvitedCampaignIds(w)).toEqual([c.id]);
  });
});

describe("appendToAllowlist — idempotent, lowercased", () => {
  it("appends once, keeps existing entries, lowercases", () => {
    const c = campaign({ allowlist: ["0x" + "a".repeat(40)] });
    const w = ("0x" + "B".repeat(40)) as string;
    expect(appendToAllowlist(c.id, w)).toBe(true);
    expect(appendToAllowlist(c.id, w)).toBe(true);
    expect(getCampaign(c.id)!.allowlist).toEqual(["0x" + "a".repeat(40), "0x" + "b".repeat(40)]);
  });
});

describe("handleRecipientStart — the /start rcp_ deep link", () => {
  const mintFor = (addr: string) => async (chatId: string) => {
    const existing = getRecipientWallet(chatId);
    if (existing) return existing;
    return saveRecipientWallet({ chatId, privyWalletId: `pw-${chatId}`, address: addr });
  };

  it("invite-only campaign: mints, binds, APPENDS to the allowlist, welcomes with the work", async () => {
    const c = campaign({ allowlist: ["0x" + "d".repeat(40)] });
    const inv = createRecipientInvite(c.id, c.posterWallet);
    const w = wallet();
    const msg = await handleRecipientStart(`chat-${n}`, inv.code, { ensureWallet: mintFor(w) });
    expect(msg).toMatch(/invited to get paid/i);
    expect(msg).toContain(w);
    expect(getCampaign(c.id)!.allowlist).toContain(w.toLowerCase());
  });

  it("OPEN campaign: never converted to invite-only by a redemption", async () => {
    const c = campaign(); // no allowlist
    const inv = createRecipientInvite(c.id, c.posterWallet);
    const msg = await handleRecipientStart(`chat-${n + 1000}`, inv.code, { ensureWallet: mintFor(wallet()) });
    expect(msg).toMatch(/invited to get paid/i);
    expect(getCampaign(c.id)!.allowlist ?? null).toBeNull(); // still open for everyone
  });

  it("someone else's link is refused honestly; a bad code too", async () => {
    const c = campaign({ allowlist: ["0x" + "d".repeat(40)] });
    const inv = createRecipientInvite(c.id, c.posterWallet);
    await handleRecipientStart("owner-chat", inv.code, { ensureWallet: mintFor(wallet()) });
    const stolen = await handleRecipientStart("thief-chat", inv.code, { ensureWallet: mintFor(wallet()) });
    expect(stolen).toMatch(/already used/i);
    const bogus = await handleRecipientStart("x-chat", "rcp_bogus", { ensureWallet: mintFor(wallet()) });
    expect(bogus).toMatch(/isn't valid/i);
  });
});
