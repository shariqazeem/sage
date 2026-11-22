import "server-only";

import type { Campaign, Submission } from "@/lib/db/schema";
import { getDecisionBySubmission, getMissionByHash, listSubmissions } from "@/lib/db/campaigns";
import type { ObservationShadow } from "@/lib/deputy/observation-judge";
import { reasonSentence } from "@/lib/deputy/reason-copy";

/**
 * P22 — HELD-QUEUE INTELLIGENCE. When a submission holds and reaches the founder, it arrives PRE-ANALYZED
 * so the founder reviews with evidence in front of them, not a bare "held" notice. Two hard design rules
 * (the user's ruling — "advisory triage is sound ONLY with anti-rubber-stamp design"):
 *
 *   1. EVIDENCE FIRST, RECOMMENDATION LAST. The surfaces render the match analysis (what the tester
 *      claimed vs what Sage saw for itself) first; the `lean` is shown last and de-emphasized.
 *   2. THE RECOMMENDATION IS DETERMINISTIC. `lean` is computed from match COUNTS + flags — never from a
 *      model reading the tester's note — so a prompt-injection in the note cannot flip it, and no LLM
 *      judgment sits between the evidence and the founder. The founder still decides; nothing here moves
 *      money, and there is deliberately no "approve all".
 *
 * `lean` is conservative by construction: "pay" ONLY when Sage's own bar objectively passed (it held for
 * arming/mainnet, not on merit); "reject" only on a fraud signal, a near-duplicate, or zero firsthand
 * match; everything else is "you-decide" — the residual that genuinely needs human judgment.
 */

export type TriageLean = "pay" | "reject" | "you-decide";

export interface HeldTriage {
  missionTitle: string;
  lane: "observation" | "url";
  /** distinct firsthand sources the account matched (observation lane), else null. */
  matched: number | null;
  /** distinct sources in Sage's pinned key — the bar is ≥3 of these (observation lane), else null. */
  keySources: number | null;
  /** which attempt this was (P20 retry counter). */
  attempt: number;
  fraudFlagged: boolean;
  nearDup: boolean;
  /** plain-language reasons it held (never model free-text; mapped from the deterministic reason tokens). */
  heldBecause: string[];
  /** ADVISORY, shown LAST. Deterministic — never swayed by the note's content. */
  lean: TriageLean;
  leanWhy: string;
}

/** Map a deterministic bar-reason token → one plain founder sentence. Safe: input is a fixed token. */
function heldReasonSentence(token: string): string {
  const base = token.replace(/\(.*\)$/, ""); // strip the "(2<3)" detail
  switch (base) {
    case "few_matches":
      return "the account matched fewer of Sage's firsthand observations than the bar requires";
    case "thin_corpus":
      return "Sage's own corpus for this mission is thin — the product was under-explored, so judge generously";
    case "high_fraud":
      return "a manipulation/fraud signal fired on the submission";
    case "near_dup":
      return "the report closely matches another submission — possible multi-wallet farming";
    case "contradiction":
      return "the account contradicts something Sage saw for itself";
    default:
      return `held (${base})`;
  }
}

/**
 * Build the deterministic triage for a HELD submission. Reads the pinned decision (observation shadow or
 * url-lane brief) and returns counts + a conservative advisory lean. Never reads or is influenced by the
 * tester's note (surfaces quote the note separately, clearly marked as unverified).
 */
export function buildHeldTriage(campaign: Campaign, submission: Submission): HeldTriage {
  const mission = submission.missionIdHash ? getMissionByHash(campaign.id, submission.missionIdHash) : null;
  const missionTitle = mission?.title ?? campaign.title;
  const decision = getDecisionBySubmission(submission.id);
  const shadow = (decision?.observationShadow ?? null) as ObservationShadow | null;
  const attempt = submission.attempt ?? 1;

  if (shadow) {
    // ── OBSERVATION lane: judged against Sage's own private eyes ──────────────
    const matched = shadow.distinctSources;
    const keySources = shadow.keyDistinctSources;
    const fraudFlagged = shadow.injectionDetected || shadow.barReasons.includes("high_fraud");
    const nearDup = shadow.barReasons.includes("near_dup") || shadow.validatedContradictions > 0;
    // A passing answer the real-try gate holds (real-try.ts) says why: it is the builder's to read, not
    // an answer that "only held because auto-pay is off".
    const tryHold = shadow.barPass ? (shadow.realTry?.hold ?? null) : null;
    // Sage's model could not read this answer (no model, or out of credit): a count of exact-wording matches
    // says nothing about an honest answer in the tester's own words, so it must never lean the builder to "no".
    const judgeAway = shadow.judgeAway === true && !shadow.barPass;
    const heldBecause = tryHold === "no_sign_of_a_try"
      ? ["it met Sage's bar, but it names nothing Sage saw behind the first screen: it could have been written from the mission card or the public page"]
      : tryHold === "public_overlap"
        ? ["it met Sage's bar, but on this mission much of what Sage can check is on the mission card or the public page, and the answer names fewer than two things from behind the first screen"]
        : shadow.barPass
          ? ["it met Sage's bar — it held only because auto-pay isn't armed for this lane yet"]
          : judgeAway
            ? ["Sage's model was not available to read this answer, so only its exact wording was checked against what Sage saw"]
            : shadow.barReasons.map(heldReasonSentence);

    let lean: TriageLean;
    let leanWhy: string;
    if (fraudFlagged) {
      lean = "reject";
      leanWhy = "a manipulation attempt was detected — not the founder's to reward";
    } else if (nearDup) {
      lean = "reject";
      leanWhy = `reads as a near-duplicate of another submission (possible farming)`;
    } else if (tryHold) {
      // Sage cannot tell this answer from one written without trying: a real judgment, the builder's.
      lean = "you-decide";
      leanWhy =
        tryHold === "no_sign_of_a_try"
          ? `it matched ${matched} of ${keySources}, all of it readable without trying the product. Read the answer and decide whether it is a real try`
          : `it matched ${matched} of ${keySources}, but this mission's card and public page give most of that away. Read the answer and decide`;
    } else if (shadow.barPass) {
      lean = "pay";
      leanWhy = `it objectively met Sage's bar (matched ${matched} of ${keySources}) — it only held because auto-pay is off`;
    } else if (judgeAway) {
      lean = "you-decide";
      leanWhy = `Sage's model could not read it, and the exact-wording check alone (${matched} of ${keySources}) misses an honest answer in the tester's own words. Read the answer and decide`;
    } else if (matched <= 0) {
      lean = "reject";
      leanWhy = "no firsthand detail matched what Sage saw — reads generic, not lived";
    } else {
      // 1..(bar-1) genuine-looking matches: the true residual — real judgment, not a nudge either way.
      lean = "you-decide";
      leanWhy = `partial firsthand detail (matched ${matched} of ${keySources}) — your call on whether the effort merits payment`;
    }
    return { missionTitle, lane: "observation", matched, keySources, attempt, fraudFlagged, nearDup, heldBecause, lean, leanWhy };
  }

  // ── URL-verifiable lane: the brain brief ─────────────────────────────────────
  const brief = decision?.brief;
  const fraudFlagged = !!brief?.fraudSignals?.some((f) => f.severity === "high" && f.signal === "prompt injection");
  const heldBecause = [reasonSentence(brief?.reasonCode)];
  let lean: TriageLean;
  let leanWhy: string;
  if (fraudFlagged) {
    lean = "reject";
    leanWhy = "a manipulation attempt was detected in the submission";
  } else if (brief?.recommendation === "pay") {
    lean = "pay";
    leanWhy = "Sage verified the evidence — it held only for your mainnet approval";
  } else {
    lean = "you-decide";
    leanWhy = "Sage couldn't confirm the work from the public evidence — your judgment";
  }
  return { missionTitle, lane: "url", matched: null, keySources: null, attempt, fraudFlagged, nearDup: false, heldBecause, lean, leanWhy };
}

/**
 * The ANALYSIS lines a founder reads FIRST (the evidence, before any recommendation). Safe on every
 * surface — counts + fixed reason sentences only, never the tester's note or model free-text.
 */
export function triageLines(t: HeldTriage): string[] {
  const lines: string[] = [];
  if (t.matched !== null && t.keySources !== null) {
    lines.push(`Matched ${t.matched} of the ${t.keySources} things Sage saw for itself.`);
  }
  if (t.heldBecause.length) lines.push(`Held because ${t.heldBecause[0]}.`);
  return lines;
}

/** The ADVISORY line, shown LAST + framed as the founder's decision (never a one-tap "approve"). */
export function leanLabel(t: HeldTriage): string {
  const verb = t.lean === "pay" ? "leans payable" : t.lean === "reject" ? "leans not payable" : "needs your judgment";
  return `Sage's read — you decide: ${verb}. ${t.leanWhy}.`;
}

/**
 * P22 — the AUTONOMOUS-RESOLUTION-RATE gauge over a campaign's OBSERVATION submissions (the arc's north
 * star: ≥90% resolved with no founder touch). Honest + computed from the pinned shadows, never inflated:
 *   · wouldPay      — barPass: Sage would auto-settle these the moment OBSERVATION_AUTOPAY is armed.
 *   · fraudFlagged  — Sage identified these as not-payable itself (the founder's decision is trivial).
 *   · needsYou      — the genuine residual that needs human judgment.
 *   · rate          — (wouldPay + fraudFlagged) / total; this is the number that must reach ≥90% (and stay
 *                     safe on the shadow) BEFORE arming autopay. With autopay off it reads as the ceiling
 *                     we're working toward, not a claim that money already moves autonomously.
 */
export interface AutonomyStats {
  total: number;
  wouldPay: number;
  fraudFlagged: number;
  needsYou: number;
  rate: number;
}

export function autonomousResolutionStats(campaignId: string): AutonomyStats {
  let total = 0;
  let wouldPay = 0;
  let fraudFlagged = 0;
  for (const s of listSubmissions(campaignId)) {
    const shadow = (getDecisionBySubmission(s.id)?.observationShadow ?? null) as ObservationShadow | null;
    if (!shadow) continue; // observation lane only
    total++;
    // a passing answer the real-try gate holds for the builder is the builder's, not an autonomous pay
    // (it falls through to `needsYou` below)
    if (shadow.barPass) {
      if (!shadow.realTry?.hold) wouldPay++;
    } else if (shadow.injectionDetected || shadow.barReasons.includes("high_fraud")) fraudFlagged++;
  }
  const needsYou = total - wouldPay - fraudFlagged;
  const rate = total > 0 ? (wouldPay + fraudFlagged) / total : 0;
  return { total, wouldPay, fraudFlagged, needsYou, rate };
}
