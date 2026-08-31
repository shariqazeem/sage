/**
 * A RELEASE CONDITION SAGE CANNOT WITNESS.
 *
 * Measured by P-DIRECT (pd-grant-conditional-on-someone-else, 2026-08-31): "send my cousin $200
 * when the bank finally approves her loan application" produced a campaign, twice. The model
 * invented a page-based proof for it — but a page the RECIPIENT writes about a third party's
 * private decision is testimony, not evidence. Sage's whole bargain is witnessing the work
 * itself; it cannot witness what happened inside a bank.
 *
 * This detector reads the FOUNDER'S OWN WORDS — the same family as `missedMoneyAction` and
 * `checkStatedTerms`, which exist because every other gate checks a plan against itself, and a
 * plan can be perfectly self-consistent while paying on something unverifiable.
 *
 * Deliberately conservative in effect: a hit does not kill the campaign, it costs ONE corrective
 * round. That matters for the honest near-misses — "when the app store approves the app" names a
 * third-party decision whose OUTCOME is public (a listing), and the correction asks the model to
 * verify that surface instead. A DAO or multisig approval is on-chain and never page-based, so
 * on-chain contracts are exempt at the call site.
 */

/** Institutions and authorities whose decisions happen in private. */
const AUTHORITY =
  /\b(bank|lender|landlord|embassy|consulate|court|judge|committee|board|jury|university|college|school|employer|hr|recruiter|insurer|insurance(?:\s+company)?|government|ministry|agency|regulator|visa\s+office|app\s*store|google|apple|amazon|platform|client)\b/i;

/** Decision verbs — the act only the authority can perform. */
const DECISION =
  /\b(approv\w*|accept\w*|admit\w*|hir\w*|decid\w*|award\w*|reject\w*|grant(s|ed)\b|sign(s|ed)?\s+off|green.?light\w*)\b/i;

/** Explicit application shapes that are decisions by construction. */
const APPLICATION =
  /\b(loan|visa|mortgage|grant|permit|application|claim)\s+(?:is|gets?|was|being)?\s*(approv\w*|accept\w*|grant\w*|clear\w*)/i;

export interface TestimonyHit {
  hit: boolean;
  /** the founder's phrase, for the correction message — never invented. */
  phrase: string | null;
}

export function testimonyCondition(founderText: string): TestimonyHit {
  const text = (founderText ?? "").trim();
  if (!text) return { hit: false, phrase: null };

  const app = APPLICATION.exec(text);
  if (app) return { hit: true, phrase: excerpt(text, app.index) };

  // Authority and decision verb within one clause of each other, either order.
  // Windowed by characters rather than parsed grammar: the founder writes chat, not contracts.
  const auth = AUTHORITY.exec(text);
  if (!auth) return { hit: false, phrase: null };
  const windowStart = Math.max(0, auth.index - 60);
  const window = text.slice(windowStart, auth.index + auth[0].length + 60);
  const dec = DECISION.exec(window);
  if (!dec) return { hit: false, phrase: null };
  return { hit: true, phrase: excerpt(text, auth.index) };
}

/** A short verbatim slice around the hit — quoted back to the model, so it must be their words. */
function excerpt(text: string, at: number): string {
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, at - 30)) + 1);
  const end = Math.min(text.length, text.indexOf(" ", at + 45) === -1 ? text.length : text.indexOf(" ", at + 45));
  return text.slice(start, end).trim();
}

/**
 * Does the planned campaign lean on a fetched page anywhere? On-chain contracts are exempt: a DAO
 * vote or a multisig approval IS the third party's decision, written where Sage can read it.
 */
export function hasPageBasedEvidence(rawMilestones: unknown[]): boolean {
  return rawMilestones.some((m) => {
    const kind = ((m as { evidence?: { kind?: unknown } })?.evidence?.kind ?? "") as string;
    return kind === "artifact_url" || kind === "public_url";
  });
}

/** The correction fed back when a page-based contract was chosen for a testimony condition. */
export function testimonyCorrection(phrase: string): string {
  return (
    `This campaign releases money on "${phrase}" — a decision made by someone other than the ` +
    `recipient, which Sage cannot read off a page the recipient writes. A recipient-authored page ` +
    `about a third party's decision is testimony, not evidence. Do ONE of: (1) if that decision ` +
    `produces a public, checkable surface (a listing, a published register, an on-chain vote), ` +
    `verify THAT — name its real host in allowedHosts or expectedText with the words that will ` +
    `appear; (2) use an on-chain proof the recipient's own wallet performs; (3) if no checkable ` +
    `proof will exist, do NOT create the campaign — tell the founder plainly that Sage can only ` +
    `pay on proof it can check itself, and ask what verifiable form the outcome will take.`
  );
}
