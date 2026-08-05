import "server-only";

import { inspectProduct } from "@/lib/launch/inspect";
import { phraseAnchors, verifyAgainstKey, type PrivateKey } from "@/lib/deputy/observation-verify";
import { takeFirstLook, FIRST_LOOK_BUDGET_MS, FIRST_LOOK_MAX_BYTES, type FirstLook } from "./first-look";
import { compileGoalJourney } from "@/lib/launch/goal-journey";

/**
 * SAGE'S CAPABILITIES, EACH STANDING ALONE.
 *
 * The whole agent was one tool: "start an inspection", which takes minutes and only makes sense if
 * you want a full campaign. Everything else Sage can do — look at a page right now, judge whether a
 * written account of using a product is genuine — was locked inside that one long flow and could not
 * be bought, called, or evaluated on its own.
 *
 * These are the pieces broken out. Each answers in seconds, each is useful to a caller who wants
 * nothing else from us, and each is a thing Sage genuinely does rather than a wrapper around a
 * model prompt.
 */

/* ── 1. Look at a page, now ───────────────────────────────────────────────────────── */

export async function capFirstLook(productUrl: string): Promise<FirstLook> {
  return takeFirstLook(productUrl);
}

/* ── 2. Judge whether an account of using a product is genuine ─────────────────────── */

export interface EvidenceCheck {
  /** true when the account reproduces things only someone who opened the product would write. */
  anchored: boolean;
  /** phrases from the page that this account also contains. Evidence, quoted back. */
  matchedPhrases: string[];
  /** distinct sections of the page the account touched. */
  matchedSections: number;
  /** how much of the page Sage had to compare against — a thin page can verify less. */
  pageSections: number;
  reachedProduct: boolean;
  verdict: "genuine" | "unverified" | "could_not_check";
  reason: string;
}

/** Turn one fetched page into a comparable key: each part of the page is its own source. */
function keyFromPage(o: {
  title: string;
  headings: string[];
  ctas: string[];
  snippets: string[];
  claims: string[];
}): PrivateKey {
  const observations: { source: string; text: string }[] = [];
  const add = (source: string, texts: readonly string[]) => {
    texts.forEach((t, i) => {
      const text = String(t ?? "").trim();
      if (text.length >= 8) observations.push({ source: `${source}:${i}`, text });
    });
  };
  add("title", [o.title]);
  add("heading", o.headings);
  add("action", o.ctas);
  add("copy", o.snippets);
  add("claim", o.claims);
  return {
    observations,
    distinctSources: new Set(observations.map((x) => x.source)).size,
    // Not a pinned campaign key, so there is no stored digest to anchor a receipt to.
    digest: "",
  };
}

/**
 * Check a written account against the product's OWN current content.
 *
 * This is the judgment layer that pays Sage's testers, offered on its own. It does not ask a model
 * whether the account sounds plausible — a fluent fabrication sounds plausible, which is exactly the
 * failure it exists to catch. It fetches the page and looks for two-word phrases from inside it that
 * the account also contains, with the account's own vocabulary subtracted from nothing: a phrase only
 * counts if the page really says it.
 *
 * Measured on Sage's own corpus, that separates a real visit from a good story cleanly, and it holds
 * when the account is written in the person's own words or another language, because product names,
 * labels and quoted copy survive paraphrase where sentence structure does not.
 *
 * HONEST LIMIT, stated in the result: this compares against ONE page as it is right now. It is not the
 * full campaign check, which compares against everything Sage saw exploring a product in a real browser.
 */
export async function capCheckEvidence(input: {
  productUrl: string;
  account: string;
}): Promise<EvidenceCheck> {
  const account = String(input.account ?? "").trim();
  if (account.length < 12) {
    return {
      anchored: false,
      matchedPhrases: [],
      matchedSections: 0,
      pageSections: 0,
      reachedProduct: false,
      verdict: "could_not_check",
      reason: "The account is too short to check. Send what the person actually wrote.",
    };
  }

  let page;
  try {
    const r = await inspectProduct(input.productUrl, {
      maxPages: 1,
      maxDepth: 0,
      timeBudgetMs: FIRST_LOOK_BUDGET_MS,
      perResponseBytes: FIRST_LOOK_MAX_BYTES,
    });
    page = r.observations[0];
  } catch {
    page = undefined;
  }
  if (!page) {
    return {
      anchored: false,
      matchedPhrases: [],
      matchedSections: 0,
      pageSections: 0,
      reachedProduct: false,
      verdict: "could_not_check",
      reason:
        "Sage could not load that page, so there is nothing to check the account against. An unreachable product is not evidence the account is false.",
    };
  }

  const key = keyFromPage(page);
  // Nothing public is subtracted here: the caller supplied the URL, so the page IS the reference.
  const anchors = phraseAnchors(account, key, []);
  const match = verifyAgainstKey(account, key);
  const anchored = anchors.length > 0;

  return {
    anchored,
    matchedPhrases: anchors.slice(0, 8),
    matchedSections: match.distinctSources,
    pageSections: key.distinctSources,
    reachedProduct: true,
    verdict: anchored ? "genuine" : "unverified",
    reason: anchored
      ? `The account reproduces ${anchors.length} phrase${anchors.length === 1 ? "" : "s"} that appear on the page itself, across ${match.distinctSources} of its ${key.distinctSources} sections. Someone who had not opened it would have to guess those exactly.`
      : "Nothing in this account appears on the page. That is what a plausible-sounding write-up from someone who never opened the product looks like. Checked against this one page as it is now, not a full browsing session.",
  };
}

/* ── 3. Turn a goal into ordered, checkable checkpoints ────────────────────────────── */

export interface GoalCheckpoints {
  goal: string;
  checkpoints: Array<{
    id: string;
    kind: string;
    /** one sentence: what must be true. */
    requirement: string;
    /** what this checkpoint is about — a page, a control, a feature. Empty when unconstrained. */
    target: string;
    /** where the requirement must hold. Empty when unconstrained. */
    context: string;
    /** checkpoint ids that must be met first. The order is structural, not advisory. */
    dependsOn: string[];
    /** the exact words in the goal that demanded this checkpoint. Verbatim, never paraphrased. */
    fromPhrase: string;
  }>;
  /** stable digest over the compiled journey — the same goal compiles to the same id. */
  digest: string;
  reason?: string;
}

/**
 * Compile a goal written in plain language into the ordered checkpoints a first-time user must
 * complete.
 *
 * This is the piece that keeps Sage's own testing honest, offered on its own. A goal like "make sure
 * people can actually book a room" hides a sequence, and the sequence is where testing goes wrong:
 * an agent that cannot tell a prerequisite from the outcome will happily report that signing up
 * works and call the job done. So each checkpoint carries what must be true, what it depends on, and
 * the exact words in the goal that demanded it — that last one is why a checkpoint cannot quietly
 * enlarge the ask, because a requirement nobody asked for has no phrase to point at.
 *
 * Needs a language model. Without one it returns no checkpoints and says so, rather than inventing
 * a plausible sequence.
 */
export async function capGoalCheckpoints(goal: string): Promise<GoalCheckpoints> {
  const clean = String(goal ?? "").trim();
  if (clean.length < 8) {
    return {
      goal: clean,
      checkpoints: [],
      digest: "",
      reason: "The goal is too short to compile. Describe what a user should be able to do.",
    };
  }

  const journey = await compileGoalJourney(clean);
  if (!journey) {
    return {
      goal: clean,
      checkpoints: [],
      digest: "",
      reason:
        "Sage could not compile this goal into checkpoints. It returns nothing rather than inventing a sequence it did not derive.",
    };
  }

  return {
    goal: journey.goal,
    checkpoints: journey.checkpoints.map((c) => ({
      id: c.checkpointId,
      kind: c.kind,
      requirement: c.requirement,
      target: c.targetEntity,
      context: c.requiredContext,
      dependsOn: c.dependsOn,
      fromPhrase: c.sourcePhrase,
    })),
    digest: journey.digest,
  };
}
