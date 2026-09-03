import "server-only";
import type { Campaign } from "@/lib/db/schema";
import { listCampaignEvents, listLiveCampaigns, listMissions, listSubmissions, recordEvent } from "@/lib/db/campaigns";
import { activeRoster, markNotified } from "@/lib/db/roster";
import { sendTelegram } from "@/lib/telegram/bot";
import { alertText, recipientsFor, type AlertableWork } from "./alerts";

/**
 * SAGE'S OWN ANNOUNCEMENT. When work goes live, the people who asked to hear about it are told —
 * once per campaign, ever, and never more than one campaign per person per cooldown.
 *
 * This is the only distribution Sage does on a founder's behalf, and it deliberately reaches only an
 * audience that opted in. It is also what closes the agent's loop: a campaign nobody sees goes quiet
 * and gets reclaimed, which spends a founder's attention to prove the board was empty.
 */

const ANNOUNCED = "work_announced" as const;

/** What can still be claimed here, and who is already involved. */
export function alertableWork(c: Campaign): AlertableWork {
  const missions = listMissions(c.id);
  const subs = listSubmissions(c.id);
  const paidByMission = new Map<string, number>();
  for (const s of subs) if (s.status === "paid") paidByMission.set(s.missionIdHash ?? "", (paidByMission.get(s.missionIdHash ?? "") ?? 0) + 1);
  const openSlots = missions.reduce((n, m) => n + Math.max(0, m.maxCompletions - (paidByMission.get(m.missionIdHash) ?? 0)), 0);
  return {
    campaignId: c.id,
    title: c.title,
    openSlots,
    rewardBase: c.rewardAmount,
    participants: subs.map((s) => s.wallet),
  };
}

function origin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return raw && raw.startsWith("http") ? raw.replace(/\/$/, "") : "https://sagepays.xyz";
}

/**
 * Announce every live campaign the roster has not been told about. Members-only work is skipped: it
 * is reachable through its own door and its audience is a workspace, not the public roster.
 */
export async function announceNewWork(nowSec = Math.floor(Date.now() / 1000)): Promise<{ campaigns: number; sent: number }> {
  // The roster is read ONCE and then kept current in memory as we go. Reading it once and never
  // updating it would apply the cooldown only between sweeps, so a tick that found three new
  // campaigns would send one person three messages — the exact abuse the cooldown exists to stop.
  const roster = activeRoster();
  let campaigns = 0;
  let sent = 0;
  if (roster.length === 0) return { campaigns, sent };
  for (const c of listLiveCampaigns()) {
    if (c.sandbox || c.visibility !== "listed") continue;
    if (listCampaignEvents(c.id).some((e) => e.kind === ANNOUNCED)) continue;
    const work = alertableWork(c);
    const to = recipientsFor(work, roster, nowSec);
    // The event is recorded even when nobody is eligible, so a campaign is considered exactly once.
    recordEvent({ campaignId: c.id, kind: ANNOUNCED, detail: `Told ${to.length} of ${roster.length} on the roster about this work` });
    campaigns += 1;
    if (to.length === 0) continue;
    const text = alertText(work, origin());
    const reached: string[] = [];
    for (const m of to) {
      try {
        if (await sendTelegram(m.target, text, { html: false })) reached.push(m.walletKey);
      } catch {
        // one unreachable person never stops the rest, and never retries into a second message
      }
    }
    markNotified(reached, nowSec);
    for (const m of roster) if (reached.includes(m.walletKey)) m.lastNotifiedAt = nowSec;
    sent += reached.length;
  }
  return { campaigns, sent };
}
