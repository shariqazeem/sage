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
    pattern: /\b(?:released|paid out|paid)\b[^!?\n]{0,60}\b(?:usdc|to the tester|the reward)\b/i,
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
    pattern: /\b(?:no|zero)\s+(?:live|active|running)\s+campaigns?\b/i,
    backedBy: ["sage_my_campaigns", "sage_stop_campaign"],
  },
];

export interface NarrationVerdict {
  ok: boolean;
  /** the claims that nothing this turn backs. */
  unbacked: string[];
}

/** Which completion claims in `reply` are not backed by a tool that succeeded this turn. */
export function checkNarration(reply: string, succeededTools: ReadonlySet<string>): NarrationVerdict {
  const unbacked: string[] = [];
  for (const c of [...CLAIMS, ...READ_CLAIMS]) {
    if (!c.pattern.test(reply)) continue;
    if (c.backedBy.some((t) => succeededTools.has(t))) continue;
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
