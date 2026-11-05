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
import { onHost, STORAGE_OR_APP_HOSTS } from "@/lib/verify/what-sage-sees";

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
  | {
      ok: false;
      reason: string;
      /** the proof that works instead, when the job says what was done on Sage */
      fix: { action: SageRecordAction } | null;
      /** what the founder adds on the card to make it payable */
      ask?: "repo";
    };

export const ANY_REPO_REASON =
  "A merged pull request in any repository proves nothing: anyone can open and merge one in their own. Name the repository it must be merged into.";
export const storageReason = (host: string) =>
  `Sage can't open ${host}: a folder or an app's own view shows nothing readable without signing in. Ask for a Google Sheet or Doc that lists the files or rows (with links) instead.`;

export const SAGE_PAGE_REASON =
  "A Sage page never shows who made it, so checking the link for the worker's wallet can never pass. For work done on Sage, Sage checks its own records instead.";

/** Can this proof ever pass, and only for the person who did the work? `texts` are the milestone's own words. */
export function proofFeasibility(
  evidence: { kind: string; allowedHosts?: readonly string[]; prMerged?: boolean; repo?: string },
  texts: readonly (string | undefined)[],
): Feasibility {
  if (evidence.kind !== "artifact_url") return { ok: true };
  if (linkLivesOnSage(evidence.allowedHosts, texts)) {
    const action = sageActionIn(texts.filter((x): x is string => !!x).join("\n"));
    return { ok: false, reason: SAGE_PAGE_REASON, fix: action ? { action } : null };
  }
  // where work is KEPT but cannot be read (what-sage-sees.ts): a folder, an app's view
  const kept = (evidence.allowedHosts ?? []).find((h) => onHost(h, STORAGE_OR_APP_HOSTS));
  if (kept) return { ok: false, reason: storageReason(kept), fix: null };
  // a merge anyone can make in their own repository is not the founder's acceptance
  if (evidence.prMerged && !evidence.repo?.trim()) return { ok: false, reason: ANY_REPO_REASON, fix: null, ask: "repo" };
  return { ok: true };
}

/** The repository a job names (github.com/owner/name), from its own words, when it names exactly one. */
export function repoIn(...texts: (string | undefined)[]): string | null {
  const found = new Set<string>();
  for (const t of texts) for (const m of (t ?? "").matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/gi)) {
    const owner = m[1]!.toLowerCase();
    if (["orgs", "settings", "marketplace", "topics", "sponsors", "features", "about", "apps", "login"].includes(owner)) continue;
    // "next.js" is a name; ".git" and a sentence's full stop are not
    const name = m[2]!.replace(/\.git$/i, "").replace(/\.+$/, "").toLowerCase();
    if (name) found.add(`${owner}/${name}`);
  }
  return found.size === 1 ? [...found][0]! : null;
}
