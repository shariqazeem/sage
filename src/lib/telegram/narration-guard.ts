import "server-only";

/**
 * A COMPLETED MONEY ACTION MUST BE BACKED BY A TOOL THAT ACTUALLY RAN.
 *
 * MEASURED live, and the worst failure this product can produce. Asked to stop a second campaign,
 * Sage replied:
 *
 *   "Done. The yara.garden campaign is stopped. I recovered 4.50 USDC and returned it to your
 *    agent wallet. Your balance is now 6.50 USDC. You have no live campaigns."
 *
 * None of it happened. There is no `sage_stop_campaign` call for that campaign anywhere in the
 * logs, the campaign is still live, no 4.50 was recovered, and the on-chain balance is 2.00. The
 * model narrated a money outcome it had merely been asked for.
 *
 * The product's own invariants already say a model never states a money amount and the feed never
 * fabricates progress — but both were enforced only where money MOVES, never over what the agent
 * SAYS afterwards. A founder reads the sentence, not the ledger. So this is the same rule applied
 * one layer out: a claim that an irreversible thing is DONE has to be backed by a successful tool
 * call in the same turn, or it does not ship.
 *
 * Deliberately narrow. It matches claims of COMPLETION, not offers, questions, or instructions —
 * "want me to stop it?" and "that would return the remaining USDC" are fine and must stay fine, or
 * the guard makes the agent useless in order to make it honest.
 */

/**
 * A claim that only a real tool result can license, and the tools that license it.
 *
 * NOTE ON THE PATTERNS: the gap between a verb and its object is `[^!?\n]{0,60}` and MUST allow
 * ".", because every money amount contains one. An earlier `[^.!?]*` could not cross "4.50" and so
 * matched none of the claims it was written to catch — the guard passed its own suite while
 * catching nothing. Bounded at 60 characters and stopped at a newline so it cannot wander into an
 * unrelated sentence.
 */
interface Claim {
  /** what the founder would take away from the sentence. */
  label: string;
  pattern: RegExp;
  /** any ONE of these having succeeded this turn is enough. */
  backedBy: readonly string[];
}

const CLAIMS: readonly Claim[] = [
  {
    label: "a campaign was stopped",
    // "is stopped", "I stopped", "has been stopped/cancelled" — not "want me to stop it?"
    pattern: /\b(?:is|are|was|were|has been|have been|i(?:'ve| have)?)\s+(?:now\s+)?(?:stopped|cancelled|canceled)\b/i,
    backedBy: ["sage_stop_campaign"],
  },
  {
    label: "funds were recovered",
    pattern: /\b(?:recovered|returned|reclaimed)\b[^!?\n]{0,60}\b(?:usdc|to your (?:agent )?wallet|to your balance)\b/i,
    backedBy: ["sage_stop_campaign", "sage_confirm_withdrawal"],
  },
  {
    label: "a withdrawal was sent",
    pattern: /\b(?:sent|withdrew|transferred)\b[^!?\n]{0,60}\busdc\b/i,
    backedBy: ["sage_confirm_withdrawal"],
  },
  {
    label: "a payout was released",
    // "paid" must not swallow the ADJECTIVE ("paid missions", "paid testing") — that reading blocked
    // the bot's own capability answer ("I create paid testing missions…") live on 2026-08-10, and the
    // founder got the fallback for asking "what can you do?".
    pattern: /\b(?:released|paid out|paid(?!\s+(?:missions?|testing|test|work|beta|slots?|campaigns?)))\b[^!?\n]{0,60}\b(?:usdc|to the tester|the reward)\b/i,
    backedBy: ["sage_confirm_release", "sage_release_submission"],
  },
  {
    label: "a campaign was launched",
    pattern: /\b(?:is|are|has been|have been|i(?:'ve| have)?)\s+(?:now\s+)?(?:live|launched|funded and launched)\b/i,
    backedBy: ["sage_fund_and_launch"],
  },
];

/**
 * A stated balance or a "no live campaigns" claim is a READ, so it is licensed by the read tools.
 * Kept separate from the list above because the failure mode differs: an unbacked balance is a
 * stale number recited from earlier in the conversation, which is how "6.50" survived three turns
 * after it stopped being true.
 */
const READ_CLAIMS: readonly Claim[] = [
  {
    label: "a wallet balance",
    pattern: /\b(?:balance is|balance:|you (?:now )?have)\b[^!?\n]{0,60}\b(?:usdc|btc)\b/i,
    backedBy: ["sage_agent_wallet_status", "sage_stop_campaign", "sage_confirm_withdrawal"],
  },
  {
    label: "how many campaigns are live",
    // "no open missions" is the tester-facing phrasing of the same read. And the MARKETPLACE tool
    // licenses it: measured 2026-08-10, the model called sage_browse_missions, reported its result
    // truthfully, and was blocked because this list only knew the founder-side tools — the agent
    // punished for doing exactly the right thing.
    pattern: /\b(?:no|zero)\s+(?:live|active|running|open)\s+(?:campaigns?|missions?)\b/i,
    backedBy: ["sage_my_campaigns", "sage_stop_campaign", "sage_browse_missions"],
  },
];

export interface NarrationVerdict {
  ok: boolean;
  /** the claims that nothing this turn backs. */
  unbacked: string[];
}

/**
 * CAPABILITY IS NOT COMPLETION. "I pay testers automatically when their work verifies" describes
 * what Sage DOES; "I paid the tester 5 USDC" claims something HAPPENED. The guard exists for the
 * second and must never fire on the first — measured live on 2026-08-10, it blocked the bot's own
 * answer to "what can you do?" because the capability description pattern-matched a money claim,
 * and the founder got the fallback twice in one conversation for asking ordinary questions.
 *
 * The exemption is sentence-scoped and marker-based: a sentence whose match sits alongside a
 * modal / future / conditional / habitual marker is a description, not a report. Deliberately a
 * closed list — every marker here makes the sentence non-assertive about the PAST, so a fabricated
 * "Done, I stopped it" can never hide behind one without stopping being a completion claim at all.
 */
const CAPABILITY_MARKERS =
  /\b(?:can|could|will|would|may|might|shall|able to|allowed to|when(?:ever)?|once|if|after|automatically|autonomously|usually|typically|normally|per (?:mission|payout|completion)|i(?:'ll| will)|to (?:pay|release|stop|cancel|send|withdraw|launch|fund))\b/i;

/** The sentence containing offset `i` — bounded by sentence punctuation or newlines. */
function sentenceAround(text: string, i: number): string {
  const start = Math.max(text.lastIndexOf(".", i), text.lastIndexOf("!", i), text.lastIndexOf("?", i), text.lastIndexOf("\n", i)) + 1;
  const ends = [text.indexOf(".", i), text.indexOf("!", i), text.indexOf("?", i), text.indexOf("\n", i)].filter((x) => x >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  return text.slice(start, end + 1);
}

/** Which completion claims in `reply` are not backed by a tool that succeeded this turn. */
export function checkNarration(reply: string, succeededTools: ReadonlySet<string>): NarrationVerdict {
  const unbacked: string[] = [];
  for (const c of [...CLAIMS, ...READ_CLAIMS]) {
    const m = c.pattern.exec(reply);
    if (!m) continue;
    if (c.backedBy.some((t) => succeededTools.has(t))) continue;
    if (CAPABILITY_MARKERS.test(sentenceAround(reply, m.index))) continue;
    unbacked.push(c.label);
  }
  return { ok: unbacked.length === 0, unbacked };
}

/**
 * The reply a founder gets INSTEAD of a fabricated one. It never guesses what really happened —
 * it says only that Sage could not stand the claim up, and points at the read that can.
 */
export function honestFallback(unbacked: string[]): string {
  const what = unbacked.length === 1 ? unbacked[0] : unbacked.join(", ");
  return [
    `I started to tell you about ${what}, but I can't stand that up — I didn't actually complete it in this step, so I'm not going to claim I did.`,
    "",
    "Ask me again and I'll run it properly, or ask for your wallet and campaigns and I'll read you the real numbers.",
  ].join("\n");
}
