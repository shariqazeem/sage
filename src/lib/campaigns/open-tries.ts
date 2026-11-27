import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, missions, submissions } from "@/lib/db/schema";
import { getDecisionBySubmission, getCampaign } from "@/lib/db/campaigns";
import { heldForBuilder } from "@/lib/test-page/tracking";
import { walletSpellings } from "./record";

/**
 * A TESTER'S ANSWERS STILL BEING DECIDED (27 Nov 2026), for Earn: the person who answered and left can see
 * what is still in flight and go back to it. Read from the rows the test page reads; the words are the ones
 * its ticket uses, so the two never disagree.
 */
export interface OpenTry {
  submissionId: string;
  campaignId: string;
  title: string;
  /** what this place pays, in base units */
  rewardBase: number;
  /** unix seconds the answer arrived */
  at: number;
  /** answered: nobody has read it yet; checking: Sage read it; approved: paid within the window; held: Sage passed it to the builder */
  state: "answered" | "checking" | "approved" | "held";
}

const OPEN = ["pending", "approved", "settling"] as const;

export function openTriesOf(wallet: string, limit = 10): OpenTry[] {
  const spellings = walletSpellings(wallet.toLowerCase()).concat(wallet.toLowerCase());
  const rows = db
    .select({ s: submissions, title: campaigns.title, reward: campaigns.rewardAmount, missionTitle: missions.title, missionReward: missions.rewardAmount })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    // the place's own mission: its title and what it pays (a test's missions can pay differently)
    .leftJoin(missions, and(eq(missions.campaignId, submissions.campaignId), eq(missions.missionIdHash, submissions.missionIdHash)))
    .where(and(inArray(sql`lower(${submissions.wallet})`, spellings), inArray(submissions.status, [...OPEN]), eq(campaigns.sandbox, false)))
    .orderBy(desc(submissions.createdAt))
    .limit(limit)
    .all();
  const heldByCampaign = new Map<string, Map<string, string>>();
  return rows.map(({ s, title, reward, missionTitle, missionReward }) => {
    let state: OpenTry["state"] = "checking";
    if (s.status === "approved" || s.status === "settling") state = "approved";
    else if (!getDecisionBySubmission(s.id)) state = "answered";
    else {
      let held = heldByCampaign.get(s.campaignId);
      if (!held) {
        const c = getCampaign(s.campaignId);
        held = c ? heldForBuilder(c) : new Map();
        heldByCampaign.set(s.campaignId, held);
      }
      if (held.has(s.id)) state = "held";
    }
    return { submissionId: s.id, campaignId: s.campaignId, title: missionTitle ?? title, rewardBase: missionReward ?? reward, at: s.createdAt, state };
  });
}
