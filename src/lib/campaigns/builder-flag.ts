import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { casSubmissionStatus, getCampaign, getSubmission, listMissions, recordEvent, updateSubmission } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { finalizationFor } from "@/lib/deputy/finalization-db";
import { encodeDetail } from "./journal";
import { ownsCampaign } from "./review-actions";

/**
 * "NOT A REAL TRY": THE BUILDER'S FLAG (20 Nov 2026, the founder's decision).
 *
 * Autopay stays. An open test's payouts wait out the finalization window (30 minutes) before they
 * settle, and during that window the builder, who knows their product best, may flag an approved answer
 * as not a real try (a parroted mission card, the wrong product), with a reason. The payout is revoked
 * exactly as the farm watch revokes one, and the tester reads the builder's words.
 *
 * Built so it can't become a way to skip paying honest people:
 * - a flag never refunds the builder. The money stays in the vault and the place reopens for someone else;
 * - a builder may flag at most one in five of a test's places (at least one);
 * - only inside the window, only an answer the agent approved (not one the builder released by hand),
 *   and only by the test's owner;
 * - the reason is recorded on the submission and in the test's public journal.
 */
export const FLAG_SHARE = 0.2;
export const REASON_MIN = 4;
export const REASON_MAX = 200;

export type FlagResult = { ok: true } | { ok: false; status: number; error: string };

/** How many answers a builder may flag on a test with this many places. */
export function flagsAllowed(totalPlaces: number): number {
  return Math.max(1, Math.floor(Math.max(0, totalPlaces) * FLAG_SHARE));
}

/** The reason in one plain line, or null when it is too short or too long to be one. */
export function flagReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length >= REASON_MIN && line.length <= REASON_MAX ? line : null;
}

function placesOf(campaignId: string, fallback: number): number {
  const missions = listMissions(campaignId).filter((m) => m.status === "active");
  return missions.length > 0 ? missions.reduce((n, m) => n + m.maxCompletions, 0) : fallback;
}

function flagsSoFar(campaignId: string): number {
  return db.select({ n: count() }).from(events).where(and(eq(events.campaignId, campaignId), eq(events.kind, "builder_flagged"))).get()?.n ?? 0;
}

export function flagAnswer(input: { submissionId: string; by: string | null; reason: unknown; now?: number }): FlagResult {
  const now = input.now ?? nowSeconds();
  const sub = getSubmission(input.submissionId);
  const campaign = sub ? getCampaign(sub.campaignId) : null;
  if (!sub || !campaign || !ownsCampaign(campaign, input.by)) return { ok: false, status: 404, error: "Not found." };
  const reason = flagReason(input.reason);
  if (!reason) return { ok: false, status: 400, error: `Say in a few words why it isn't a real try (${REASON_MIN} to ${REASON_MAX} characters). The tester reads it.` };
  if (sub.status === "paid" || sub.status === "settling") {
    return { ok: false, status: 409, error: "It was already paid. A flag works in the 30 minutes after Sage approves an answer, before it settles." };
  }
  if (sub.status !== "approved") {
    return { ok: false, status: 409, error: "You can flag an answer once Sage has approved it, in the 30 minutes before it is paid." };
  }
  const fin = finalizationFor(sub, campaign.visibility, now);
  if (fin.state === "release") return { ok: false, status: 409, error: "You released this one yourself, so it settles as you decided." };
  if (fin.state !== "waiting") return { ok: false, status: 409, error: "The 30 minutes have passed, so it settles as Sage decided." };
  const allowed = flagsAllowed(placesOf(campaign.id, campaign.maxRecipients));
  if (flagsSoFar(campaign.id) >= allowed) {
    return { ok: false, status: 429, error: `You've flagged ${allowed} of this test's answers, the most a test allows. Sage's own checks still run on the rest.` };
  }
  if (!casSubmissionStatus(sub.id, "approved", "rejected")) {
    return { ok: false, status: 409, error: "That answer just changed. Open the test again to see where it stands." };
  }
  const said = `The builder said: ${reason}`;
  updateSubmission(sub.id, { rejectReason: said });
  recordEvent({ campaignId: campaign.id, submissionId: sub.id, kind: "submission_rejected", detail: encodeDetail(said) });
  recordEvent({ campaignId: campaign.id, submissionId: sub.id, kind: "builder_flagged", detail: encodeDetail(reason) });
  return { ok: true };
}
