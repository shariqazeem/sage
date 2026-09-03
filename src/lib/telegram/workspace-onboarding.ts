import "server-only";

import { getInvite, getWorkspace, listWorkspaceCampaigns, redeemInvite, telegramMemberKey } from "@/lib/db/workspaces";
import { limitsOf } from "@/lib/workspaces/plan";
import { ensureRecipientWallet } from "@/lib/privy/recipient";
import { privyConfigured } from "@/lib/privy/client";
import type { RecipientWallet } from "@/lib/db/schema";
import { siteUrl } from "@/lib/site";

/**
 * SAGE FOR TEAMS from a phone — `/start ws_inv_<code>`. The invited person gets a Sage wallet (no
 * app, no seed phrase; this chat is their account), joins the workspace, and is shown the open
 * work. Deterministic, no model: joining a team is not a conversation.
 */
export async function handleWorkspaceStart(
  chatId: string,
  code: string,
  deps: { ensureWallet?: (chatId: string) => Promise<RecipientWallet> } = {},
): Promise<string> {
  const invite = getInvite(code);
  const ws = invite ? getWorkspace(invite.workspaceId) : null;
  if (!invite || !ws) return "That invite link isn't valid — ask whoever sent it for a fresh one.";
  if (!privyConfigured() && !deps.ensureWallet) {
    return "Invites aren't available right now — the wallet service isn't configured. Please tell whoever sent you this link.";
  }
  let wallet: RecipientWallet;
  try {
    wallet = await (deps.ensureWallet ?? ensureRecipientWallet)(chatId);
  } catch (err) {
    console.error("[workspace-onboarding] wallet mint failed:", err instanceof Error ? err.message : err);
    return "I couldn't set up your wallet just now — tap the invite link again in a moment.";
  }
  const r = redeemInvite(code, { memberKey: telegramMemberKey(chatId), address: wallet.address }, { memberCap: limitsOf(ws).members });
  if (!r.ok) {
    return r.reason === "member_cap"
      ? `"${ws.name}" is full on its current plan — ask the owner to upgrade, then tap the link again.`
      : r.reason === "revoked" || r.reason === "exhausted"
        ? "That invite link is no longer open — ask for a new one."
        : "That invite link isn't valid — ask whoever sent it for a fresh one.";
  }
  const open = listWorkspaceCampaigns(ws)
    .filter((c) => c.status === "live")
    .slice(0, 5)
    .map((c) => `• ${c.title} — pays $${(c.rewardAmount / 1_000_000).toFixed(2)} · ${siteUrl()}/c/${c.id}`)
    .join("\n");
  const intro = r.already
    ? `You're already a member of "${ws.name}".`
    : `Welcome to "${ws.name}" on Sage. I've set up a wallet for you — no app, no seed phrase; this chat is your account.`;
  return (
    `${intro}\n\n` +
    (open ? `Open work right now:\n${open}\n\n` : "Nothing is open right now — I'll tell you here the moment your team posts work.\n\n") +
    `When you've done a piece of work, send me the link to it here — I verify it and, if it checks out, the USDC lands in your wallet.\n` +
    `Your wallet address: ${wallet.address}`
  );
}
