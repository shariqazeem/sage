import "server-only";
import { loadCampaignActivity } from "./load-activity";
import type { ActivityEvent } from "./activity";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sameFounder } from "@/lib/auth/founder";

/**
 * THE FOUNDER'S DESK — the agent's recent work across EVERYTHING they own, one ledger.
 *
 * Built entirely on the per-campaign projection (`loadCampaignActivity`), so its evidence-leak
 * safety lives in exactly one place and this file cannot weaken it: an aggregation of safe rows is
 * safe. Each row carries its campaign's name and door, because on a desk with several things
 * running, "paid $0.50" without WHICH is a number, not information.
 */
export interface DeskEvent extends ActivityEvent {
  campaignId: string;
  campaignTitle: string;
}

export interface FounderDesk {
  events: DeskEvent[];
  /** the most recent moment Sage recorded work anywhere on this desk. */
  lastWorkedAt: number | null;
}

export function loadFounderDesk(founderWallet: string, limit = 10): FounderDesk {
  const mine = db
    .select({ id: campaigns.id, title: campaigns.title, posterWallet: campaigns.posterWallet })
    .from(campaigns)
    .where(eq(campaigns.sandbox, false))
    .all()
    .filter((c) => sameFounder(c.posterWallet, founderWallet));

  const events: DeskEvent[] = [];
  let lastWorkedAt: number | null = null;
  for (const c of mine) {
    const a = loadCampaignActivity(c.id, limit);
    if (a.lastCheckedAt !== null) {
      lastWorkedAt = lastWorkedAt === null ? a.lastCheckedAt : Math.max(lastWorkedAt, a.lastCheckedAt);
    }
    for (const e of a.activity) {
      events.push({ ...e, campaignId: c.id, campaignTitle: c.title });
    }
  }
  events.sort((a, b) => b.at - a.at);
  return { events: events.slice(0, limit), lastWorkedAt };
}
