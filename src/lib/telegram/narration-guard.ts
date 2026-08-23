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
    pattern: /\b(?:is|are|was|were|has been|have been|i(?:'ve| have)?)\s+(?:(?:now|already|officially|successfully|just)\s+){0,2}(?:stopped|cancelled|canceled)\b/i,
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
    label: "an inspection was started",
    /**
     * THE ENTRY POINT, AND IT WAS UNGUARDED. 23 Aug 14:11 UTC: a founder was told "Inspection
     * started. ~90 seconds, up to 11 minutes. Sage is browsing metis.io now." — no tool call in
     * the logs, no row in inspection_jobs, nothing running. They sat waiting for a plan that was
     * never coming, and the "watching it live" link was missing for the same reason: it is sent
     * from the tool result, and there was no tool result.
     *
     * Every other claim here is about money. This one is about whether the product did anything
     * at all, which is the first thing a founder ever asks it to do.
     *
     * It recurred an hour later wearing different words — "Inspection already running for
     * metis.io from your last message" — a phrase that exists nowhere in this codebase, about a
     * job that had finished the previous day. Hence "running / in progress / underway" here too.
     */
    pattern: /\b(?:inspection (?:has (?:now )?)?started|inspection (?:is )?(?:already )?(?:running|in progress|underway)|started (?:the |your )?inspection|i(?:'m| am) (?:now )?(?:inspecting|browsing|looking at)|(?:sage|it) is (?:now )?(?:inspecting|browsing))\b/i,
    backedBy: ["sage_start_inspection", "sage_answer_questions"],
  },
  {
    label: "a campaign was launched",
    // THE ADVERB HOLE. This read `(?:now\s+)?` and a founder was told "That campaign is ALREADY
    // live" — with an invented campaign id — because "already" is not "now", so the guard never
    // fired on a launch that never happened. The adverb list is explicit, and deliberately excludes
    // "still" and "currently": those describe an ongoing state a read tool can legitimately report,
    // while "already"/"now" are what a fresh action gets dressed in.
    // The verbless headline is the third wording this has arrived in: "**Missions live:** 3 x
    // tester missions on www.metis.io ($2.00 total)" — sent while sage_fund_and_launch had just
    // answered ok:false on a failed gas estimate. Matches "missions live", never "live missions",
    // so the marketplace copy ("explore live missions") still passes.
    pattern: /\b(?:is|are|was|were|has been|have been|i(?:'ve| have)?)\s+(?:(?:now|already|officially|successfully|just)\s+){0,2}(?:live|launched|funded and launched)\b|\b(?:missions?|campaigns?)\s+(?:are\s+)?live\b/i,
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

/**
 * LINKS MUST COME FROM TOOLS, NOT FROM THE MODEL.
 *
 * Phrasing guards are a cat-and-mouse game — one adverb walked through the launch claim. An id is
 * not: a founder was handed `sagepays.xyz/campaign/6765e4a42d03110008e8ebc8`, a shape Sage does not
 * even mint, for a campaign that was never created. So every campaign/plan/proof link in a reply
 * must appear verbatim in what the tools actually returned this turn. A model cannot invent its way
 * around this one, whatever words it wraps around the link.
 */
const LINK_RE = /https?:\/\/[^\s)"']*\/(?:campaign|c|launch|proof)\/[A-Za-z0-9_-]+/gi;

function fabricatedLinks(reply: string, toolOutput: string): string[] {
  const seen = new Set<string>();
  for (const m of reply.matchAll(LINK_RE)) {
    const url = m[0].replace(/[.,;:]+$/, "");
    const id = url.split("/").pop() ?? "";
    // the id is what identifies it; a tool may have returned the same link with a different host.
    if (id && !toolOutput.includes(id)) seen.add(url);
  }
  return [...seen];
}

/** Which completion claims in `reply` are not backed by a tool that succeeded this turn. */
export function checkNarration(
  reply: string,
  succeededTools: ReadonlySet<string>,
  /** everything the tools returned this turn — used to prove any link the reply hands over. */
  toolOutput = "",
): NarrationVerdict {
  const unbacked: string[] = [];
  for (const c of [...CLAIMS, ...READ_CLAIMS]) {
    const m = c.pattern.exec(reply);
    if (!m) continue;
    if (c.backedBy.some((t) => succeededTools.has(t))) continue;
    if (CAPABILITY_MARKERS.test(sentenceAround(reply, m.index))) continue;
    unbacked.push(c.label);
  }
  if (toolOutput && fabricatedLinks(reply, toolOutput).length > 0)
    unbacked.push("a campaign link Sage never created");
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
