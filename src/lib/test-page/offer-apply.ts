import "server-only";

import type { InspectionJob } from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/campaigns";
import { createRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { deserializePlan } from "@/lib/launch/serde";
import { MISSION_PROMPT_VERSION } from "@/lib/launch/mission-prompt";
import { offerPlan } from "@/lib/launch/offer";
import { DEFAULT_TEST } from "@/lib/site/paste-link";
import { DEFAULT_EACH_BASE, DEFAULT_PEOPLE, offerOf } from "./offer-shape";

/**
 * SAVING AN OFFER (relaunch, 20 Nov 2026): the offer card's two numbers, written as the plan's next
 * revision. One function for the card's own request and for the default below, so there is one way a
 * test's people and reward ever change. The caller has already decided WHO may change it.
 */
export type ApplyOfferResult =
  | { ok: true; changed: boolean; revision: number }
  | { ok: false; status: 400 | 409; error: string; currentRevision?: number };

/** Why this plan's people and reward can't be changed here, or null when they can. */
export function offerLockedWhy(job: Pick<InspectionJob, "id" | "status" | "publicCampaignId">): string | null {
  if (job.status !== "ready") return "There is no plan to price yet.";
  if (getCampaign(job.publicCampaignId)) return "This test is already paid for, so its people and reward are fixed.";
  const current = getCurrentRevision(job.id);
  if (!current) return "There is no plan to price yet.";
  const kind = deserializePlan(current.planJson).campaignKind;
  if (kind && kind !== "testing") return "This plan's amounts are the ones you wrote, so they are changed where you wrote them.";
  // A plan whose checks are bound to its exact amounts (a replay covenant) keeps them: a new revision
  // would carry no covenant, and dropping one silently is not this card's decision to make.
  if (current.verificationPolicyRequired === true) return "Sage tied this plan's checks to its exact amounts, so the people and reward stay as they are.";
  return null;
}

export function applyOffer(
  job: InspectionJob,
  author: string,
  offer: { people: number; eachBase: number; inviteOnly?: boolean; expectedRevision?: number },
): ApplyOfferResult {
  const locked = offerLockedWhy(job);
  if (locked) return { ok: false, status: 409, error: locked };
  const current = getCurrentRevision(job.id)!;
  if (typeof offer.expectedRevision === "number" && offer.expectedRevision !== current.revisionNumber) {
    return { ok: false, status: 409, error: "This test changed in another tab. It has been reloaded.", currentRevision: current.revisionNumber };
  }
  const plan = deserializePlan(current.planJson);
  const now = offerOf(plan.missions);
  const visibility = offer.inviteOnly === undefined ? undefined : offer.inviteOnly ? ("unlisted" as const) : ("listed" as const);
  const sameMoney = now.people === offer.people && now.eachBase === offer.eachBase;
  const sameDoor = visibility === undefined || (plan.visibility ?? "listed") === visibility;
  if (sameMoney && sameDoor) return { ok: true, changed: false, revision: current.revisionNumber };

  const next = offerPlan(
    plan,
    { people: offer.people, eachBase: BigInt(offer.eachBase), visibility },
    {
      productMapDigest: (current.productMapDigest ?? `0x${"0".repeat(64)}`) as `0x${string}`,
      model: current.model,
      promptVersion: MISSION_PROMPT_VERSION,
      revision: current.revisionNumber + 1,
    },
  );
  if (!next.ok) return { ok: false, status: 400, error: next.error };
  const row = createRevision({
    jobId: job.id,
    authorWallet: author,
    reason: "rebalance",
    plan: next.plan,
    budgetBase: next.plan.totalBudgetBase,
    validationOk: true,
    model: current.model,
    provider: current.provider,
  });
  return { ok: true, changed: true, revision: row.revisionNumber };
}

/**
 * THE DEFAULT TEST IS 10 PEOPLE AT $2.00 (the founder's decision, 20 Nov 2026).
 *
 * The paste box starts every test with a $20.00 budget, and the mission designer then decides its own
 * places and rewards from it (often 4 people at $5.00). Work above $2.00 is held for people without a
 * record (`IDENTITY_TIERS`), so that plan would fill slowly for a reason the builder never chose. The
 * first time the plan's owner opens a freshly designed $20.00 test, it is set to the default once.
 *
 * Only ever the untouched first revision of a default-budget test, never one that is approved,
 * launched, re-priced or edited, and never by a stranger's visit. Returns true when it changed the plan.
 */
export function ensureDefaultOffer(job: InspectionJob, author: string): boolean {
  if (job.status !== "ready" || Number(job.totalBudgetBase) !== DEFAULT_TEST.budgetUsd * 1_000_000) return false;
  const current = getCurrentRevision(job.id);
  if (!current || current.revisionNumber !== 1 || current.reason !== "generated" || current.approvedAt != null) return false;
  if (offerLockedWhy(job)) return false;
  const shape = offerOf(deserializePlan(current.planJson).missions);
  if (shape.people === DEFAULT_PEOPLE && shape.eachBase === DEFAULT_EACH_BASE) return false;
  if (shape.missions > DEFAULT_PEOPLE) return false;
  const r = applyOffer(job, author, { people: DEFAULT_PEOPLE, eachBase: DEFAULT_EACH_BASE, expectedRevision: 1 });
  return r.ok && r.changed;
}
