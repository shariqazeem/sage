import "server-only";

import type { Campaign } from "@/lib/db/schema";
import { campaignWorkspace, listMembers } from "@/lib/db/workspaces";
import { getRecipientWalletByAddress } from "@/lib/db/recipient-wallets";
import { sendTelegram } from "@/lib/telegram/bot";
import { siteUrl } from "@/lib/site";

/**
 * "YOUR TEAM POSTED WORK." The closed loop's pull: the moment a workspace campaign goes live, every
 * member Sage can reach on Telegram hears about it — members who joined from Telegram (their key is
 * their chat) and wallet members whose address is a Sage-minted recipient wallet. Web-only members
 * see it on their workspace page. Best-effort, never on the money path: a failed message is logged
 * and the campaign is live regardless.
 */
export async function notifyWorkspaceNewWork(campaign: Campaign): Promise<number> {
  const ws = campaignWorkspace(campaign);
  if (!ws) return 0;
  const chats = new Set<string>();
  for (const m of listMembers(ws.id)) {
    if (m.role === "owner") continue;
    if (m.memberKey.startsWith("tg:")) chats.add(m.memberKey.slice(3));
    else if (m.address) {
      const rw = getRecipientWalletByAddress(m.address);
      if (rw) chats.add(rw.chatId);
    }
  }
  if (chats.size === 0) return 0;
  const pays = `$${(campaign.rewardAmount / 1_000_000).toFixed(2)} USDC`;
  const text =
    `📌 New work in "${ws.name}": ${campaign.title}\n` +
    `Pays ${pays} per verified completion.\n` +
    `${siteUrl()}/c/${campaign.id}\n\n` +
    `Do the work, then send me the link to it here — I verify it and pay to your Sage wallet.`;
  let sent = 0;
  for (const chatId of chats) {
    try {
      await sendTelegram(chatId, text, { html: false });
      sent += 1;
    } catch (err) {
      console.error("[workspace-notify] failed:", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
