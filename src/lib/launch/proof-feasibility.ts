/**
 * A PROOF THAT CAN NEVER PASS IS NEVER LAUNCHED (5 Nov 2026).
 *
 * A founder typed "whoever launches a job on sagepays.xyz, pay them 0.5 usdc each". Sage wrote a tidy card
 * whose proof was "a link that carries the worker's wallet address", the link being their Sage job page.
 * A Sage page never shows who posted it, so every honest worker would have been refused, and the card still
 * offered a Launch button. The founder would have funded a job that could pay nobody.
 *
 * This file names only what Sage KNOWS cannot pass, never a guess about the work. The server refuses such a
 * job (direct-campaign.ts), the drafter converts it (gig-draft.ts), and the card explains it and offers the
 * proof that works (job-card.tsx). One rule, three doors, so they cannot disagree.
 */
import type { SageRecordAction } from "@/lib/verify/contract";
import { isSageHost } from "@/lib/verify/sage-record";

const SAGE_PAGE_IN_WORDS = [
  // "the submitted link opens a live job page on sagepays.xyz", "a page at sagepays.xyz"
  /\b(link|url|page)\b[^.\n]{0,60}\b(on|at|from)\s+(?:https?:\/\/)?(?:www\.)?sagepays\.xyz\b/i,
  // a Sage job, receipt or record link spelled out
  /\bsagepays\.xyz\/(?:c|campaign|proof|jobs?|record)\b/i,
];

/** The work's link is a page on Sage's own site, by its hosts or by what the job says the link is. */
export function linkLivesOnSage(allowedHosts: readonly string[] | undefined, texts: readonly (string | undefined)[]): boolean {
  if ((allowedHosts ?? []).some(isSageHost)) return true;
  const t = texts.filter((x): x is string => !!x).join("\n");
  return SAGE_PAGE_IN_WORDS.some((re) => re.test(t));
}

const LAUNCH = /\b(launch(?:es|ed|ing)?|post(?:s|ed|ing)?|creat(?:e|es|ed|ing)|publish(?:es|ed|ing)?|start(?:s|ed|ing)?|fund(?:s|ed|ing)?|run(?:s|ning)?)\b[^.\n]{0,40}\b(jobs?|gigs?|bount(?:y|ies)|grants?|tasks?|campaigns?|missions?|product tests?)\b/i;
const PAID = /\b(paid|payouts?|earn(?:s|ed|ing)?|receipts?)\b/i;
const SAGE = /\b(sage|sagepays(?:\.xyz)?)\b/i;

/** The Sage action a job describes, when it describes one: launching a job comes first, then being paid. */
export function sageActionIn(text: string): SageRecordAction | null {
  if (LAUNCH.test(text)) return "launched_job";
  if (PAID.test(text) && SAGE.test(text)) return "was_paid";
  return null;
}

export type Feasibility =
  | { ok: true }
  | { ok: false; reason: string; /** the proof that works instead, when the job says what was done on Sage */ fix: { action: SageRecordAction } | null };

export const SAGE_PAGE_REASON =
  "A Sage page never shows who made it, so checking the link for the worker's wallet can never pass. For work done on Sage, Sage checks its own records instead.";

/** Can this proof ever pass? `texts` are the milestone's own words: title, deliverable, steps, criteria. */
export function proofFeasibility(evidence: { kind: string; allowedHosts?: readonly string[] }, texts: readonly (string | undefined)[]): Feasibility {
  if (evidence.kind === "artifact_url" && linkLivesOnSage(evidence.allowedHosts, texts)) {
    const action = sageActionIn(texts.filter((x): x is string => !!x).join("\n"));
    return { ok: false, reason: SAGE_PAGE_REASON, fix: action ? { action } : null };
  }
  return { ok: true };
}
