import "server-only";

import { getCampaign, listMissions } from "@/lib/db/campaigns";
import type { Campaign } from "@/lib/db/schema";
import { getProgramme, roundForCampaign } from "@/lib/programmes/store";
import { siteUrl } from "@/lib/site";
import { linkFor, seatMessage, seatsForCampaign, seatsTaken } from "./seats";

/**
 * What the founder sees for a job made for their own people: the one link, how many have joined, and a
 * message ready to paste. A programme's rounds share ONE link (the programme's), so the people a founder
 * sent it to in week 1 are still in for week 8.
 */
export interface SeatLinkInfo {
  code: string;
  url: string;
  seats: number;
  taken: number;
  message: string;
  /** the link admits to every round of a programme */
  programmeId: string | null;
}

/** What one person is paid on this job: the reward when there is one mission, the sum when there are stages. */
export function rewardPerPersonUsd(campaignId: string): number | null {
  const ms = listMissions(campaignId).filter((m) => m.status === "active");
  if (ms.length === 0) return null;
  return ms.reduce((s, m) => s + m.rewardAmount, 0) / 1_000_000;
}

export function seatLinkFor(campaign: Campaign, createdBy: string): SeatLinkInfo {
  const round = roundForCampaign(campaign.id);
  const programme = round ? getProgramme(round.programmeId) : null;
  const seats = seatsForCampaign(campaign.id);
  const link = programme ? linkFor({ programmeId: programme.id }, createdBy, seats) : linkFor({ campaignId: campaign.id }, createdBy, seats);
  const url = `${siteUrl()}/join/${link.code}`;
  return {
    code: link.code,
    url,
    seats: link.seats,
    taken: seatsTaken(link.code),
    message: seatMessage({ title: programme?.title ?? campaign.title, rewardUsd: rewardPerPersonUsd(campaign.id), url, everyWeek: !!programme && programme.everyDays === 7 }),
    programmeId: programme?.id ?? null,
  };
}

/** For the seat page: what a link opens onto, with nothing about who else holds a seat. */
export function seatLinkPublic(link: { campaignId: string | null; programmeId: string | null; seats: number; code: string }, currentCampaignId: string | null): {
  title: string;
  rewardUsd: number | null;
  seatsLeft: number;
  everyDays: number | null;
  roundsTotal: number | null;
  campaignId: string | null;
} | null {
  const programme = link.programmeId ? getProgramme(link.programmeId) : null;
  const campaignId = link.campaignId ?? currentCampaignId;
  const campaign = campaignId ? getCampaign(campaignId) : null;
  if (!campaign && !programme) return null;
  return {
    title: programme?.title ?? campaign?.title ?? "A job",
    rewardUsd: campaign ? rewardPerPersonUsd(campaign.id) : programme ? programme.roundBudgetBase / 1_000_000 / Math.max(1, link.seats) : null,
    seatsLeft: Math.max(0, link.seats - seatsTaken(link.code)),
    everyDays: programme?.everyDays ?? null,
    roundsTotal: programme?.roundsTotal ?? null,
    campaignId: campaign?.id ?? null,
  };
}
