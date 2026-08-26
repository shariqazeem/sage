import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { recipientInvites, recipientWallets, type RecipientInvite, type RecipientWallet } from "./schema";
import { nowSeconds } from "./keys";

/**
 * WALLETLESS RECIPIENTS — durable state (move 2, docs/work-proof-design.md + the pivot).
 *
 * A recipient's Telegram chat is their account. `recipient_wallets` binds chat ↔ the Privy server
 * wallet Sage minted for them; `recipient_invites` are founder-minted, WRITE-ONCE codes that bind
 * the first chat to open them. All lookups are keyed server-side (chatId / code) — a model or a
 * caller never passes someone else's identity.
 */

export function getRecipientWallet(chatId: string): RecipientWallet | null {
  return db.select().from(recipientWallets).where(eq(recipientWallets.chatId, chatId)).get() ?? null;
}

export function getRecipientWalletByAddress(address: string): RecipientWallet | null {
  return (
    db.select().from(recipientWallets).where(eq(recipientWallets.address, address.toLowerCase())).get() ?? null
  );
}

export function saveRecipientWallet(input: { chatId: string; privyWalletId: string; address: string }): RecipientWallet {
  const row = {
    chatId: input.chatId,
    privyWalletId: input.privyWalletId,
    address: input.address.toLowerCase(),
    createdAt: nowSeconds(),
  };
  db.insert(recipientWallets).values(row).onConflictDoNothing().run();
  return getRecipientWallet(input.chatId)!;
}

/** Mint one invite code for a campaign. The caller has already verified campaign ownership. */
export function createRecipientInvite(campaignId: string, createdByWallet: string): RecipientInvite {
  const row = {
    code: `rcp_${nanoid(12)}`,
    campaignId,
    createdByWallet: createdByWallet.toLowerCase(),
    createdAt: nowSeconds(),
  };
  db.insert(recipientInvites).values(row).run();
  return db.select().from(recipientInvites).where(eq(recipientInvites.code, row.code)).get()!;
}

export function getRecipientInvite(code: string): RecipientInvite | null {
  return db.select().from(recipientInvites).where(eq(recipientInvites.code, code)).get() ?? null;
}

export type RedeemResult =
  | { ok: true; invite: RecipientInvite; already: boolean }
  | { ok: false; reason: "not_found" | "claimed_by_other" };

/**
 * WRITE-ONCE redemption. The first chat to open the link binds it (an atomic conditional UPDATE —
 * two racing chats cannot both win); the SAME chat re-tapping is idempotent; a different chat is
 * refused. The wallet recorded is the minted recipient wallet, lowercased.
 */
export function redeemRecipientInvite(code: string, chatId: string, wallet: string): RedeemResult {
  const invite = getRecipientInvite(code);
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.redeemedChatId) {
    if (invite.redeemedChatId === chatId) return { ok: true, invite, already: true };
    return { ok: false, reason: "claimed_by_other" };
  }
  const res = db
    .update(recipientInvites)
    .set({ redeemedChatId: chatId, redeemedWallet: wallet.toLowerCase(), redeemedAt: nowSeconds() })
    .where(and(eq(recipientInvites.code, code), isNull(recipientInvites.redeemedChatId)))
    .run();
  if (res.changes === 0) {
    // lost the race — re-read and answer honestly
    const now = getRecipientInvite(code)!;
    return now.redeemedChatId === chatId
      ? { ok: true, invite: now, already: true }
      : { ok: false, reason: "claimed_by_other" };
  }
  return { ok: true, invite: getRecipientInvite(code)!, already: false };
}

/** Every campaign this wallet was invited to (redeemed invites), newest first. */
export function listInvitedCampaignIds(wallet: string): string[] {
  const rows = db
    .select()
    .from(recipientInvites)
    .where(eq(recipientInvites.redeemedWallet, wallet.toLowerCase()))
    .all();
  return [...new Set(rows.sort((a, b) => (b.redeemedAt ?? 0) - (a.redeemedAt ?? 0)).map((r) => r.campaignId))];
}
