import "server-only";

import { appendToAllowlist, getCampaign, listMissions } from "@/lib/db/campaigns";
import { redeemRecipientInvite } from "@/lib/db/recipient-wallets";
import { ensureRecipientWallet } from "@/lib/privy/recipient";
import { privyConfigured } from "@/lib/privy/client";
import type { RecipientWallet } from "@/lib/db/schema";

/**
 * WALLETLESS RECIPIENT onboarding — the `/start rcp_<code>` deep link (move 2).
 *
 * The founder minted the code for ONE campaign; the first chat to open it becomes that invited
 * person: Sage mints their Privy wallet (their chat is their account) and — only when the campaign
 * is invite-only (allowlist already non-empty) — appends the minted wallet to it. An OPEN campaign
 * is never silently converted to invite-only by a redemption: appending the first wallet to an
 * empty allowlist would lock everyone else out, so open campaigns skip the append (the recipient
 * can submit anyway, like anyone).
 */
export async function handleRecipientStart(
  chatId: string,
  code: string,
  deps: { ensureWallet?: (chatId: string) => Promise<RecipientWallet> } = {},
): Promise<string> {
  if (!privyConfigured() && !deps.ensureWallet) {
    return "Invites aren't available right now — the wallet service isn't configured. Please tell whoever sent you this link.";
  }
  let wallet: RecipientWallet;
  try {
    wallet = await (deps.ensureWallet ?? ensureRecipientWallet)(chatId);
  } catch (err) {
    console.error("[recipient-onboarding] wallet mint failed:", err instanceof Error ? err.message : err);
    return "I couldn't set up your wallet just now — tap the invite link again in a moment.";
  }
  const redeemed = redeemRecipientInvite(code, chatId, wallet.address);
  if (!redeemed.ok) {
    return redeemed.reason === "not_found"
      ? "That invite link isn't valid — ask the funder to send you a fresh one."
      : "That invite was already used by someone else — ask the funder for your own link.";
  }
  const campaign = getCampaign(redeemed.invite.campaignId);
  if (!campaign) return "That invite's campaign no longer exists — ask the funder what happened.";

  // Invite-only campaigns gain this wallet; OPEN campaigns are left open (see module doc).
  if (Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0) {
    appendToAllowlist(campaign.id, wallet.address);
  }

  const open = listMissions(campaign.id)
    .filter((m) => m.status === "active")
    .slice(0, 3)
    .map((m) => `• ${m.title} — pays $${(m.rewardAmount / 1_000_000).toFixed(2)}`)
    .join("\n");

  const intro = redeemed.already
    ? `You're already set up for "${campaign.title}".`
    : `You're invited to get paid on "${campaign.title}". I've set up a wallet for you — no app, no seed phrase; this chat is your account.`;

  return (
    `${intro}\n\n` +
    (open ? `The work:\n${open}\n\n` : "") +
    `When you've done it, just send me the link to your work (or the transaction hash) right here — I'll verify it and, if it checks out, USDC lands in your wallet with a public receipt.\n\n` +
    `Your wallet address: ${wallet.address}\nAsk me "what's my balance?" or "what's my work?" anytime.`
  );
}
