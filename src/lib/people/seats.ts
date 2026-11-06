import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { appendToAllowlist, getCampaign, listMissions } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { jobLinks, jobSeats, type JobLink } from "@/lib/db/schema";

/**
 * PEOPLE: A JOB'S OWN LINK FOR N PEOPLE, ON EVERY PLAN (6 Nov 2026).
 *
 * Measured on prod the same day: every job a founder made for "my people" launched into silence.
 * - On Free, members-only work had no door at all: workspace invites are Pro (402).
 * - The engine already paid a named list (`allowlist`, which skips World ID and membership), but only the
 *   old direct form could set it, and it wanted 0x addresses the founder didn't have.
 *
 * Now the founder sends one link. Each person who opens it and signs in (email or MetaMask) takes one
 * seat, and their wallet joins the job's named list. The founder vouches for who they send it to, which
 * is why World ID is not asked. The vault, the caps and the judge are unchanged: a seat admits a person to
 * the work, never to the money.
 *
 * Everything here is synchronous: one Node thread runs a claim from the seat count to the insert without
 * interleaving, so N seats can never become N+1. The (scope, wallet) primary key is the second lock.
 */

export const SEAT_PREFIX = "seat_";
export const isSeatCode = (code: string) => code.startsWith(SEAT_PREFIX) && /^seat_[A-Za-z0-9_-]{8,40}$/.test(code);

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function getJobLink(code: string): JobLink | null {
  if (!isSeatCode(code)) return null;
  return db.select().from(jobLinks).where(eq(jobLinks.code, code)).get() ?? null;
}

/** The people a job is for: its largest mission's paid completions (a gig for 40 people has 40 slots). */
export function seatsForCampaign(campaignId: string): number {
  const counts = listMissions(campaignId).map((m) => m.maxCompletions);
  return Math.max(1, ...counts);
}

function linkWhere(scope: { campaignId: string } | { programmeId: string }) {
  return "campaignId" in scope
    ? and(eq(jobLinks.campaignId, scope.campaignId), isNull(jobLinks.revokedAt))
    : and(eq(jobLinks.programmeId, scope.programmeId), isNull(jobLinks.revokedAt));
}

/**
 * The link for a job (or a programme): minted the first time it is asked for, the same link every time
 * after, so a founder who copies it twice has sent one link, not two with separate seat counts.
 */
export function linkFor(scope: { campaignId: string } | { programmeId: string }, createdBy: string, seats: number): JobLink {
  const existing = db.select().from(jobLinks).where(linkWhere(scope)).get();
  if (existing) return existing;
  const row = {
    code: `${SEAT_PREFIX}${nanoid(14)}`,
    campaignId: "campaignId" in scope ? scope.campaignId : null,
    programmeId: "programmeId" in scope ? scope.programmeId : null,
    seats: Math.max(1, Math.floor(seats)),
    createdBy: createdBy.toLowerCase(),
    createdAt: nowSeconds(),
    revokedAt: null,
  };
  db.insert(jobLinks).values(row).run();
  return row;
}

export function seatsTaken(code: string): number {
  return db
    .select()
    .from(jobSeats)
    .where(and(eq(jobSeats.linkCode, code), isNull(jobSeats.removedAt)))
    .all().length;
}

/** The wallets holding a seat in a job or programme, in the order they joined. */
export function seatHolders(scopeId: string): string[] {
  return db
    .select()
    .from(jobSeats)
    .where(and(eq(jobSeats.scopeId, scopeId), isNull(jobSeats.removedAt)))
    .all()
    .sort((a, b) => a.claimedAt - b.claimedAt)
    .map((s) => s.wallet);
}

/**
 * A place puts the person on the job's named list. Only on work for the founder's own people (unlisted, or
 * already named): the first name on an empty list turns a public job into a named one and locks everyone
 * else out, so public work is never appended to. Its link holders submit like anyone there.
 */
function admit(campaignId: string, wallet: string): void {
  const c = getCampaign(campaignId);
  if (!c) return;
  const named = Array.isArray(c.allowlist) && c.allowlist.length > 0;
  if (c.visibility === "unlisted" || named) appendToAllowlist(campaignId, wallet);
}

export type ClaimResult =
  | { ok: true; already: boolean; campaignId: string | null; seatsLeft: number }
  | { ok: false; reason: "not_found" | "revoked" | "full" | "not_evm" | "ended"; message: string };

const OPEN_STATUSES = new Set(["live", "draft"]);

/**
 * Take a seat. `currentCampaign` resolves a programme's link to the round that is open now (null between
 * rounds: the seat still counts, and the next round admits it).
 */
export function claimSeat(
  code: string,
  wallet: string,
  opts: { currentCampaign?: (programmeId: string) => { campaignId: string | null; ended: boolean } } = {},
): ClaimResult {
  const link = getJobLink(code);
  if (!link) return { ok: false, reason: "not_found", message: "That link isn't valid. Ask whoever sent it for a fresh one." };
  if (link.revokedAt) return { ok: false, reason: "revoked", message: "That link was turned off by the person who sent it." };
  if (!EVM_ADDRESS.test(wallet)) {
    return { ok: false, reason: "not_evm", message: "Sign in with your email or MetaMask: this work pays an Ethereum-style address." };
  }
  const w = wallet.toLowerCase();

  let campaignId: string | null = link.campaignId;
  if (link.programmeId) {
    const cur = opts.currentCampaign?.(link.programmeId) ?? { campaignId: null, ended: false };
    if (cur.ended) return { ok: false, reason: "ended", message: "This programme has finished. Nothing more to join." };
    campaignId = cur.campaignId;
  } else {
    const c = campaignId ? getCampaign(campaignId) : null;
    if (!c || !OPEN_STATUSES.has(c.status)) return { ok: false, reason: "ended", message: "This job has closed. Nothing more to join." };
  }

  const scopeId = link.campaignId ?? link.programmeId!;
  const mine = db.select().from(jobSeats).where(and(eq(jobSeats.scopeId, scopeId), eq(jobSeats.wallet, w))).get();
  if (mine && !mine.removedAt) {
    if (campaignId) admit(campaignId, w); // idempotent: heals a round opened before the seat landed
    return { ok: true, already: true, campaignId, seatsLeft: Math.max(0, link.seats - seatsTaken(code)) };
  }
  if (mine?.removedAt) return { ok: false, reason: "revoked", message: "The person who sent this link took your place back. Ask them about it." };

  const taken = seatsTaken(code);
  if (taken >= link.seats) {
    return { ok: false, reason: "full", message: `All ${link.seats} ${link.seats === 1 ? "place is" : "places are"} taken. Ask whoever sent the link whether there is room.` };
  }
  db.insert(jobSeats).values({ scopeId, wallet: w, linkCode: code, claimedAt: nowSeconds(), removedAt: null }).onConflictDoNothing().run();
  if (campaignId) admit(campaignId, w);
  return { ok: true, already: false, campaignId, seatsLeft: Math.max(0, link.seats - taken - 1) };
}

/** What the founder sends: a short message in their voice, the link at the end. Pure, for the suite. */
export function seatMessage(input: { title: string; rewardUsd: number | null; url: string; everyWeek?: boolean }): string {
  const pay = input.rewardUsd !== null ? `$${input.rewardUsd.toFixed(2).replace(/\.00$/, "")} in USDC` : "USDC";
  const when = input.everyWeek ? " every week" : "";
  return `${input.title}: I'm paying ${pay}${when} for this. Open your link, sign in with your email, and do it there. Sage checks the work and pays you in minutes, with a receipt. ${input.url}`;
}
