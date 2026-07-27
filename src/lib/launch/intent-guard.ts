/**
 * INTENT FIDELITY — the founder's goal may be rephrased, never enlarged.
 *
 * A founder wrote: "make users launch campaign, funding campaign not requires". The agent expanded
 * that into "navigate the site, CONNECT THEIR WALLET, and initiate the creation of a campaign".
 * Nobody asked for a wallet. But an expanded goal becomes ordered checkpoints, and checkpoints are
 * hard requirements — so four of six could never be observed (Sage cannot connect a wallet, and must
 * not), the run stalled, and the founder was asked to restate the goal they had already given.
 *
 * The invention was helpfulness, and it cost the whole plan. So a rephrasing is allowed to describe
 * the SAME work in other words; it is not allowed to introduce a GATED ACTION — connecting a wallet,
 * signing in, paying, approving a transaction — that the founder never mentioned, or that they
 * explicitly ruled out.
 *
 * Deterministic and product-agnostic: it only ever REMOVES a clause the founder's own words don't
 * support. It never adds, never rewrites, and when it cannot parse cleanly it leaves the goal alone.
 */

/** Action families that turn into unobservable requirements when invented. Each is a real boundary:
 *  Sage cannot hold a wallet, own an account, or spend a founder's money to witness an outcome. */
const GATED: { family: string; re: RegExp }[] = [
  { family: "wallet", re: /\b(wallet|metamask|connect\s+wallet|web3\s*wallet|sign\s+(?:the\s+)?(?:message|transaction)|on[- ]chain\s+transaction)\b/i },
  { family: "payment", re: /\b(fund(?:ing|s|ed)?|pay(?:ment|ing)?|purchase|checkout|deposit|top\s*up|subscribe|billing)\b/i },
  { family: "account", re: /\b(log\s*in|login|sign\s*in|sign\s*up|signup|register|create\s+an?\s+account|authenticate|credentials?)\b/i },
  { family: "approval", re: /\b(approve|approval|confirm\s+the\s+transaction|authorize)\b/i },
];

/**
 * Did the founder EXCLUDE this family? Catches the shapes people actually write:
 * "funding not required", "without funding", "don't fund it", "no need to pay", "not needed".
 */
function excluded(founderText: string, re: RegExp): boolean {
  const t = founderText.toLowerCase();
  for (const m of t.matchAll(new RegExp(re.source, "gi"))) {
    const at = m.index ?? 0;
    const around = t.slice(Math.max(0, at - 60), Math.min(t.length, at + 60));
    if (
      // NOTE the trailing \w* on the "require" stems: founders write "not required" and "not
      // requires", and a \b after "require" fails mid-word on both — which is how "funding campaign
      // not requires" was read as no exclusion at all.
      /\b(not\s+require\w*|isn'?t\s+require\w*|no\s+need|not\s+needed|without|don'?t|do\s+not|skip\w*|never|exclude\w*|not\s+necessary)\b/i.test(
        around,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Split a goal sentence into the clauses a founder would recognise as separate asks. */
function clauses(goal: string): string[] {
  return goal
    .split(/(?:,|;|\band then\b|\bthen\b|\band\b)/gi)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export interface GuardedGoal {
  /** the goal with unsupported gated clauses removed (or the original when nothing was dropped). */
  goal: string;
  /** the action families that were removed, for an honest note back to the founder. */
  dropped: string[];
}

/**
 * Keep an expanded goal faithful to what the founder actually asked for.
 *
 * A gated clause survives only when the founder's OWN words mention that family and did not rule it
 * out. Everything else in the goal passes through untouched — this is a filter on invention, not a
 * rewrite of intent. If filtering would leave nothing, the original goal is returned unchanged:
 * refusing to plan is worse than planning against a slightly wide goal.
 */
export function guardGoalAgainstFounder(
  founderText: string | null | undefined,
  proposedGoal: string | null | undefined,
): GuardedGoal {
  const goal = (proposedGoal ?? "").trim();
  const founder = (founderText ?? "").trim();
  if (!goal || !founder) return { goal, dropped: [] };

  const parts = clauses(goal);
  if (parts.length <= 1) {
    // A single-clause goal is the founder's whole ask — dropping it would leave nothing to plan.
    return { goal, dropped: [] };
  }

  const dropped: string[] = [];
  const kept = parts.filter((c) => {
    for (const g of GATED) {
      if (!g.re.test(c)) continue;
      const founderMentions = g.re.test(founder);
      const founderExcluded = excluded(founder, g.re);
      if (!founderMentions || founderExcluded) {
        if (!dropped.includes(g.family)) dropped.push(g.family);
        return false;
      }
    }
    return true;
  });

  if (kept.length === 0 || dropped.length === 0) return { goal, dropped: [] };
  // rejoin naturally: the clauses were the founder's own sequence
  const rebuilt = kept.join(", ").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
  return { goal: rebuilt.length > 0 ? rebuilt : goal, dropped };
}
