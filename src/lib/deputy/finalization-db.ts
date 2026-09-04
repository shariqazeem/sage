import "server-only";
import type { Submission } from "@/lib/db/schema";
import { getDecisionBySubmission, getLatestSubmissionEvent, listSubmissions, listSubmissionsForDedup } from "@/lib/db/campaigns";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { sameNullifierWallets } from "@/lib/identity/person";
import { matured, revocationReason, windowSecondsFor } from "./finalization";

export type Finalization =
  | { state: "release" }
  | { state: "waiting"; finalizesAt: number }
  | { state: "finalize" }
  | { state: "revoke"; reason: string };

/**
 * Where an approved submission stands. A founder's explicit release (a `submission_approved` event
 * newer than any `autopay_approved`) settles now. An agent approval waits out its window, then the
 * watch runs against everything on the campaign — including what arrived after the approval.
 */
export function finalizationFor(sub: Submission, visibility: "listed" | "unlisted" | null | undefined, nowSec: number): Finalization {
  const agent = getLatestSubmissionEvent(sub.id, "autopay_approved");
  const founder = getLatestSubmissionEvent(sub.id, "submission_approved");
  if (!agent || (founder && founder.createdAt >= agent.createdAt)) return { state: "release" };
  const windowSec = windowSecondsFor(visibility);
  if (!matured(agent.createdAt, windowSec, nowSec)) return { state: "waiting", finalizesAt: agent.createdAt + windowSec };
  const decision = getDecisionBySubmission(sub.id);
  const reason = revocationReason({
    me: { note: sub.note, contentSha256: decision?.contentSha256 ?? null, artifactFingerprint: decision?.artifactFingerprint ?? null },
    others: listSubmissionsForDedup(sub.campaignId, sub.id),
    linkedWallets: linkedWalletsOf(sub.wallet),
    personWallets: sameNullifierWallets(sub.wallet),
    peerWallets: listSubmissions(sub.campaignId).filter((s) => s.id !== sub.id).map((s) => s.wallet),
  });
  return reason ? { state: "revoke", reason } : { state: "finalize" };
}
