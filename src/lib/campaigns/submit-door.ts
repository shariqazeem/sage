import "server-only";

import type { Campaign } from "@/lib/db/schema";
import { meetsTier, openTierCeilingBase, requiredTier, tierRefusal } from "@/lib/identity/tier";
import { identityTiersArmed, standingOf } from "@/lib/identity/standing";
import { PERSONHOOD_DOOR_COPY, alreadyClaimedCopy, identityDoorArmed } from "@/lib/identity/door";
import { personWallets } from "@/lib/identity/person";
import { identityFor } from "@/lib/db/identity";
import { worldIdConfig } from "@/lib/identity/worldid";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { campaignWorkspace } from "@/lib/db/workspaces";
import { isWorkspacePerson } from "@/lib/workspaces/person-role";
import { countPaidByWalletsInCampaign } from "@/lib/db/campaigns";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import { isSanctionedWallet, SANCTIONS_LIST_LABEL } from "@/lib/deputy/sanctions";

/**
 * WHO MAY SUBMIT WORK TO A JOB: ONE DOOR POLICY FOR EVERY DOOR.
 *
 * The web submit route grew its checks one incident at a time:
 * - the sanctions screen;
 * - the named recipient list;
 * - one person, one slot on public work (World ID);
 * - a person's payout cap across every wallet that is them;
 * - the reward-tier rule;
 * - members-only work for a team.
 *
 * The Telegram door copied only some of them, so a farmer turned away at the web door for want of a
 * personhood proof could walk in through chat. Found by reading both doors side by side, 5 Nov 2026.
 *
 * So the policy lives here and both doors call it. A check added for one door now reaches every door.
 * Each refusal says what to do next, never just "no".
 */
export type DoorRefusal = {
  ok: false;
  status: number;
  error: string;
  /** the person needs a one-time personhood proof; the web board opens the widget for it. */
  needsVerification?: boolean;
  action?: string | null;
};

export function checkSubmitDoor(campaign: Campaign, wallet: string, opts: { surface: "web" | "telegram" } = { surface: "web" }): { ok: true } | DoorRefusal {
  if (isSanctionedWallet(wallet)) {
    return { ok: false, status: 403, error: `This wallet appears on the ${SANCTIONS_LIST_LABEL} and cannot participate.` };
  }
  // A named recipient list (direct grants and gigs): an application-level gate, stated honestly as such.
  // The vault still enforces caps, budget and replay for whoever gets through. Chain-aware membership,
  // because a felt's spelling varies by padding.
  if (Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0 && !campaign.allowlist.some((a) => sameChainAddress(a, wallet))) {
    return {
      ok: false,
      status: 403,
      error: opts.surface === "telegram"
        ? "Your wallet isn't on this job's recipient list — open your invite link first."
        : "This campaign pays a named recipient list, and your wallet isn't on it. Contact the operator.",
    };
  }
  // ONE PERSON, ONE SLOT on public work: a one-time personhood proof (no name, no document, no country),
  // and the caps count people rather than wallets. Members-only work is untouched: the team chose its people.
  const publicWork = isPublicWork(campaign);
  if (identityDoorArmed() && publicWork && worldIdConfig() && !identityFor(wallet)) {
    return {
      ok: false,
      status: 403,
      error: opts.surface === "telegram"
        ? `${PERSONHOOD_DOOR_COPY} Open the job on the web to do it once; after that, you can submit from chat.`
        : PERSONHOOD_DOOR_COPY,
      needsVerification: true,
      action: worldIdConfig()?.action ?? null,
    };
  }
  // One person, paid at most `perWalletPayoutCap` times on this job, across every wallet that is them.
  // Checked at the door so nobody does work the pipeline will only hold; the pipeline re-checks.
  if (publicWork && countPaidByWalletsInCampaign(campaign.id, personWallets(wallet)) >= campaign.perWalletPayoutCap) {
    return { ok: false, status: 409, error: alreadyClaimedCopy("campaign") };
  }
  // The older reward-tier rule stays only while the door is unarmed: two gates with different theories
  // of who may pass must never both speak.
  if (!identityDoorArmed() && identityTiersArmed()) {
    const need = requiredTier(campaign.rewardAmount);
    const standing = standingOf(wallet);
    if (!meetsTier(standing.tier, need)) {
      return { ok: false, status: 403, error: tierRefusal(standing, need, campaign.rewardAmount, openTierCeilingBase()) };
    }
  }
  // A team's unlisted work is its own: only its members submit. A stranger is told whose door it is.
  // Someone the founder NAMED on the job's recipient list was chosen by the founder; the list check above
  // has already proven this wallet is on it, so the membership check would only turn away the person
  // the founder invited by name.
  const named = Array.isArray(campaign.allowlist) && campaign.allowlist.length > 0;
  if (campaign.visibility === "unlisted" && !named) {
    const ws = campaignWorkspace(campaign);
    if (ws && !isWorkspacePerson(ws.id, wallet)) {
      return {
        ok: false,
        status: 403,
        error: `This work is for members of "${ws.name}". Ask the workspace owner for an invite link, join with this wallet, and submit again.`,
      };
    }
  }
  return { ok: true };
}
