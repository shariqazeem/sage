import "server-only";

import { listCampaignEvents, listLiveCampaigns, listSubmissions, recordEvent } from "@/lib/db/campaigns";
import { notifyFounderQuietCampaign } from "@/lib/telegram/founder-notify";

/**
 * CAMPAIGN HEALTH NUDGE (FC Phase 3) — the agent's lifecycle sense. A funded campaign with zero
 * submissions after two days is money waiting on reach, and the founder usually doesn't know.
 * Sage notices on the sweep and says so ONCE per campaign — with the two actions it can actually
 * take from chat (mint a personal invite, or stop and reclaim). One nudge ever, recorded as a
 * campaign event; never a stream, never a fabricated urgency.
 */

const QUIET_AFTER_SECONDS = 48 * 3600;
export const QUIET_NUDGE_EVENT = "campaign_quiet_nudge";

export async function runCampaignHealthNudges(nowSec = Math.floor(Date.now() / 1000)): Promise<{ nudged: number }> {
  let nudged = 0;
  for (const c of listLiveCampaigns()) {
    try {
      if (c.sandbox) continue;
      if (nowSec - (c.createdAt ?? nowSec) < QUIET_AFTER_SECONDS) continue;
      if (listSubmissions(c.id).length > 0) continue; // anyone showed up → not quiet
      if (listCampaignEvents(c.id).some((e) => e.kind === QUIET_NUDGE_EVENT)) continue; // once, ever
      const sent = await notifyFounderQuietCampaign(c, nowSec);
      if (!sent) continue; // not a chat-launched campaign — nothing to push to (yet)
      recordEvent({ campaignId: c.id, kind: QUIET_NUDGE_EVENT, detail: "48h, zero submissions — founder nudged once" });
      nudged += 1;
    } catch {
      // one campaign's failure never blocks the sweep or the other nudges
    }
  }
  return { nudged };
}
