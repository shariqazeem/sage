import "server-only";

import { createServerWallet } from "./client";
import { getRecipientWallet, saveRecipientWallet } from "@/lib/db/recipient-wallets";
import type { RecipientWallet } from "@/lib/db/schema";

/**
 * WALLETLESS RECIPIENT wallets (move 2). A recipient's chat is their account: on first invite
 * redemption Sage mints them a Privy server wallet and binds it to the chat.
 *
 * CUSTODY, honestly: the wallet is policy-LESS (unlike founder wallets, which are born under a
 * spend mandate) because a recipient only RECEIVES — the app exposes no transaction path for these
 * wallets except an explicit, chat-confirmed withdrawal (separate tool). The key never leaves
 * Privy; the app is the only signer; `PRIVY_APP_SECRET` was already the master credential for
 * every agent wallet, so this adds no new credential class. Balances here are payout-sized. This
 * trade-off is stated in the compliance statement, not hidden.
 */
export async function ensureRecipientWallet(chatId: string): Promise<RecipientWallet> {
  const existing = getRecipientWallet(chatId);
  if (existing) return existing;
  const w = await createServerWallet();
  return saveRecipientWallet({ chatId, privyWalletId: w.id, address: w.address });
}
