import type { CandidateMission, MissionPriority, SourceRef } from "./schemas";

/**
 * THE WORK SAGE CANNOT DO IS EXACTLY THE WORK A PAID TESTER IS FOR.
 *
 * Some of the most valuable thing a founder wants proven sits behind a boundary Sage must never
 * cross: buying credits, paying for compute, creating a real account, signing a transaction. Sage
 * gets as far as the gate, sees the pricing page and the button, and stops — correctly.
 *
 * What happened next was the failure. The goal compiled into checkpoints Sage could not observe, the
 * grounded gate refused the plan, and the legacy brain designed missions from whatever it COULD see.
 * Measured live on clawup.org with a $400 budget and the goal "testers must launch an agent, which
 * requires purchasing credits and paying for compute with their own money": eight pages inspected,
 * nine checkpoints, and the plan Sage returned was **Validate Logo Safety Zone Compliance**. A brand
 * guidelines page. The founder asked about their product's core flow and got its logo.
 *
 * A human with their own wallet can walk straight through that gate. That is not a gap in the plan,
 * it is the plan. So when the founder ASKED for a gated action, this builds a mission for it.
 *
 * Three rules keep it honest:
 *
 *   1. ONLY WHAT THE FOUNDER ASKED FOR. The gated families here mirror `intent-guard`, which exists
 *      because the agent once invented a wallet step nobody wanted and killed a whole plan. A family
 *      qualifies only when the founder's own words name it. Sage never decides on its own that
 *      testers should spend money.
 *
 *   2. ANCHORED ON THE GATE SAGE ACTUALLY SAW. The mission cites observed text — the pricing
 *      surface, the purchase control — so it passes the same anchor gate as every other mission. The
 *      action happens beyond Sage's reach; the doorway does not.
 *
 *   3. VERIFIED AGAINST WHAT THE PRODUCT WROTE DOWN. Originally these were forced url-verifiable
 *      ("Sage has no corpus for a screen it never loaded") — but a URL behind auth cannot be
 *      fetched either; the payout lane would hit the login wall. Since 2026-08-10 the private key
 *      is fed by the DOCUMENTATION Sage read (`doc:` sources in distillPrivateKey), so the
 *      observation lane genuinely can judge these: the tester's own-words account must match the
 *      product's documented labels and order, and read as lived experience. That is the founder's
 *      explicit ask — "verify the evidence based on its learning of browsing and product
 *      learning, not whether it browsed that part".
 */

/** A boundary Sage must not cross. Mirrors `intent-guard`'s families, which is the point: the same
 *  actions that must never be INVENTED are the ones that must be PLANNED when genuinely requested.
 *  `core_action` is the one product-specific member: the thing the founder's own verb names doing
 *  INSIDE the product ("launch an agent", "mint a badge") — always behind the account gate, named in
 *  their words, never invented from ours. */
export type GatedFamily = "payment" | "account" | "wallet" | "approval" | "core_action";

const FAMILY_PATTERNS: { family: GatedFamily; re: RegExp }[] = [
  {
    family: "payment",
    re: /\b(purchas\w+|buy(?:ing)?|pay(?:ment|ing|s)?|paid|checkout|billing|credits?|top\s*up|subscri\w+|deposit)\b/i,
  },
  {
    family: "account",
    // "make an account" is how the clawup founder actually said it, and this pattern only knew
    // "create". A founder's phrasing is the trigger, so the verbs here must cover how people talk:
    // make / open / set up / get an account, alongside the formal ones.
    re: /\b(sign\s*up|signup|register\w*|(?:create|make|open|set\s*up|get)\s+(?:an?\s+|your\s+)?account|log\s*in|login|sign\s*in)\b/i,
  },
  { family: "wallet", re: /\b(wallet|metamask|connect\s+wallet|sign\s+(?:the\s+)?transaction)\b/i },
  { family: "approval", re: /\b(approve|approval|authorize|confirm\s+the\s+transaction)\b/i },
];

/** Roughly how much of a tester's time a gated action costs beyond ordinary clicking. Payment is the
 *  expensive one: they leave the product, use a real payment method, and wait for it to settle. */
const FAMILY_EFFORT: Record<GatedFamily, number> = {
  payment: 25,
  account: 12,
  wallet: 15,
  approval: 8,
  core_action: 15, // signing up AND doing the product's central action — the longest mission here
};

/** Plain words for the mission text. Never a model's phrasing — this text has to pass a regex gate. */
const FAMILY_NOUN: Record<GatedFamily, string> = {
  payment: "the paid step",
  account: "the account step",
  wallet: "the wallet step",
  approval: "the approval step",
  core_action: "the core step", // overridden per action: the founder's own object word names it
};

/** The noun the mission text uses. core_action speaks in the founder's own object word, because
 *  "complete the core step" tells a tester nothing and "complete the agent step" tells them a lot. */
function nounFor(action: GatedAction): string {
  return action.family === "core_action" && action.objectNoun
    ? `the ${action.objectNoun} step`
    : FAMILY_NOUN[action.family];
}

export interface GatedAction {
  family: GatedFamily;
  /** the founder's own words that asked for this. Verbatim — never paraphrased, never invented. */
  sourcePhrase: string;
  /** observed text marking the gate. A literal substring of the corpus, so the mission anchors. */
  gateAnchor: string;
  /** core_action only: the founder's own object word ("agent"), used for anchoring and coverage. */
  objectNoun?: string;
  /** set when this action was INFERRED from the product (delegated launch, no founder goal). The
   *  mission then speaks in the product's voice ("this is <product>'s core action"), never claims
   *  "the founder asked for this" about words the founder never wrote. */
  delegated?: boolean;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The founder's sentence that names this family, trimmed to something quotable. */
function founderSentenceFor(goal: string, re: RegExp): string | null {
  for (const raw of goal.split(/(?<=[.!?])\s+|\n+/)) {
    const s = norm(raw);
    if (s.length >= 8 && re.test(s)) return s.slice(0, 240);
  }
  return re.test(goal) ? norm(goal).slice(0, 240) : null;
}

/**
 * The observed line that best marks where this gate begins.
 *
 * Preference order is deliberate: a line that names the family AND looks like a control ("Buy
 * credits", "Upgrade") beats a line that merely mentions it in prose, because the mission should
 * point a tester at a doorway rather than at a paragraph about one. Falls back to any observed line
 * naming the family — an imperfect anchor still beats an unanchored mission, which cannot exist.
 */
export function findGateAnchor(
  observedLines: readonly string[],
  re: RegExp,
  minLen = 8,
): string | null {
  const candidates = observedLines
    .map(norm)
    .filter((l) => l.length >= minLen && l.length <= 120 && re.test(l));
  if (candidates.length === 0) return null;
  const controlish = candidates.filter((l) => l.split(/\s+/).length <= 6);
  return (controlish[0] ?? candidates[0]) ?? null;
}

/**
 * Which gated actions did the FOUNDER ask for, and can Sage point at the doorway for each?
 *
 * Returns at most one per family: two missions for "buy credits" and "purchase a plan" would be the
 * same work billed twice.
 */
/** The product's core-action verb + object ("create your agent", "launch a bot"). Shared by the
 *  founder-worded detector and the delegated inference. */
const CORE_RE =
  /\b(launch|deploy|mint|publish|build|generate|start|run|creat(?:e|ing))\s+(?:an?\s+|the\s+|your\s+|new\s+)?([a-z][\w-]{2,24})\b/i;
/** Words the fixed families already own, plus generic fillers that name no product feature. */
const NOT_AN_OBJECT =
  /^(account|accounts|wallet|wallets|transaction|payment|profile|password|it|them|one|thing|stuff|website|site|page)$/;
/** For the DELEGATED inference only: additionally reject filler verbs/nouns that a docs sentence
 *  pairs with a core verb but that name no product object ("get started", "build something"). */
const DELEGATED_FILLER = /^(started|something|anything|everything|more|out|up|into|with|your|our|the|new|now|free)$/;

export function detectGatedActions(
  founderGoal: string | null | undefined,
  observedLines: readonly string[],
): GatedAction[] {
  const goal = norm(founderGoal ?? "");
  if (!goal) return [];

  const out: GatedAction[] = [];
  for (const { family, re } of FAMILY_PATTERNS) {
    if (!re.test(goal)) continue; // the founder never asked for this — see rule 1
    const gateAnchor = findGateAnchor(observedLines, re);
    if (!gateAnchor) continue; // Sage never saw the doorway — it cannot anchor, so it does not claim
    const sourcePhrase = founderSentenceFor(goal, re);
    if (!sourcePhrase) continue;
    out.push({ family, sourcePhrase, gateAnchor });
  }

  /**
   * THE PRODUCT'S OWN VERB — the reason most founders came.
   *
   * The fixed families cover the GATES (pay, sign up, connect, approve). They cannot cover what the
   * founder wants done PAST the gate, because that is different for every product: "launch an
   * agent", "mint a badge", "publish a store". On the clawup run the founder said "make an account
   * and try to launch an agent" — the account half now matches above, but "launch an agent" matched
   * nothing, so the one mission the whole campaign existed for was never even attempted, and the
   * plan shipped brand-asset trivia instead.
   *
   * The founder's verb + object is extracted from THEIR sentence (rule 1 holds: never invented),
   * and the anchor is any observed line naming the object — which, now that read documentation is
   * part of the corpus, a docs page about agents satisfies even when the console itself is walled.
   */
  const core = goal.match(CORE_RE);
  if (core) {
    const objectNoun = core[2].toLowerCase();
    if (!NOT_AN_OBJECT.test(objectNoun)) {
      const objectRe = new RegExp(`\\b${objectNoun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`, "i");
      const gateAnchor = findGateAnchor(observedLines, objectRe);
      const sourcePhrase = founderSentenceFor(goal, CORE_RE);
      if (gateAnchor && sourcePhrase) {
        out.push({ family: "core_action", sourcePhrase, gateAnchor, objectNoun });
      }
    }
  }
  return out;
}

/**
 * DELEGATION IS CONSENT — the core action a first-time visitor is here to do, inferred from the
 * PRODUCT'S OWN description when the founder said nothing.
 *
 * `detectGatedActions` reads the founder's words and, by intent-guard's rule, never invents an
 * action they didn't name. But when the founder chose "let Sage decide" (a URL-only launch, no
 * goal), they explicitly asked Sage to pick the goal — so inferring the product's core action is
 * doing what was delegated, not inventing an unwanted step. The signal is grounded, never invented:
 * the action is read from the product's OWN observed text (its docs' "create your agent", its value
 * proposition), and it must anchor to an observed line exactly like every other mission — so a
 * static page with no create-flow yields nothing and stays on its public missions, unchanged.
 *
 * This is the fix for the walled-product plan that shipped "read the homepage" missions: ClawUp's
 * quick-start says "create your first agent", so Sage now builds "sign up and create your agent,
 * then submit the result" instead of "confirm the homepage mentions agents".
 */
export function inferDelegatedCoreAction(
  observedLines: readonly string[],
  valuePropositions: readonly string[] = [],
): GatedAction | null {
  const lines = [...valuePropositions, ...observedLines].map(norm).filter((l) => l.length >= 6 && l.length <= 240);
  // The core OBJECT is the distinctive noun that (a) RECURS across the product's own copy — a central
  // object appears many times, a passing word once — and (b) sits near a create/launch verb somewhere.
  // Naive "the word after the verb" grabs adjectives and conjunctions ("Build AND Power…", "create
  // your FIRST agent"); frequency + verb-co-occurrence finds "agent" instead. Fully deterministic.
  const STOP = new Set(
    ("the a an and or of to for your our their with new now free out up into on at is are be this that these those " +
      "you we they it them us start started building build create creating make made get getting got launch launching " +
      "deploy run running use using power ai app apps web").split(" "),
  );
  const freq = new Map<string, number>();
  const withVerb = new Set<string>();
  const wordPhrase = new Map<string, string>();
  for (const l of lines) {
    const words = l.toLowerCase().match(/[a-z][a-z-]{2,24}/g) ?? [];
    const hasVerb = CORE_RE.test(l);
    for (const w of words) {
      if (STOP.has(w) || NOT_AN_OBJECT.test(w) || DELEGATED_FILLER.test(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
      if (!wordPhrase.has(w) || l.length < wordPhrase.get(w)!.length) wordPhrase.set(w, l);
      if (hasVerb) withVerb.add(w);
    }
  }
  // candidates: distinctive nouns that co-occur with a create-verb AND recur (≥2 mentions — a
  // central object is repeated; a one-off "journey" in "start your journey" is not the product).
  const candidates = [...withVerb].filter((w) => (freq.get(w) ?? 0) >= 2);
  if (candidates.length === 0) return null;
  const objectNoun = candidates.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || (a < b ? -1 : 1))[0]!;
  const objectRe = new RegExp(`\\b${objectNoun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`, "i");
  const gateAnchor = findGateAnchor(observedLines, objectRe);
  if (!gateAnchor) return null; // must anchor to something Sage observed, like every mission
  return {
    family: "core_action",
    // the PRODUCT'S own phrase, verbatim from what Sage read — honest provenance, never founder words.
    sourcePhrase: (wordPhrase.get(objectNoun) ?? gateAnchor).slice(0, 140),
    gateAnchor,
    objectNoun,
    delegated: true,
  };
}

/**
 * Words that mean the tester CARRIES THE ACTION OUT, as opposed to writing about it.
 *
 * `FAMILY_PATTERNS` deliberately matches nouns — "credits", "billing", "payment" — because its job
 * is spotting the action in the FOUNDER'S sentence, where those nouns are exactly how a person asks
 * for it. Using the same pattern to ask "does an existing mission already cover this?" answers a
 * different question with the wrong instrument, and it silently dropped the mission that mattered.
 *
 * MEASURED on two clawup.org runs an hour apart, same product, same goal ("testers launch an agent,
 * which needs topping up credits and paying for compute first"). One produced the gated-payment
 * mission. The other did not, because the architect happened to write two missions that merely
 * MENTION payment — "the agents users are paying to deploy" and "data usage policies regarding
 * billing and service telemetry" — and the noun match read those as already covering it. A mission
 * about what the privacy policy SAYS about billing is not a mission that makes anyone buy credits,
 * so the founder's own stated requirement produced no mission at all, in silence.
 *
 * Deliberately biased toward NOT suppressing: a duplicate paid mission is a visible, cheap mistake
 * a founder can delete, and a missing one is invisible.
 */
const FAMILY_ACTION: Record<GatedFamily, RegExp> = {
  // core_action is handled in alreadyCovered directly — its regex depends on the founder's object
  // word, which a static table cannot express. The entry here only satisfies the Record type.
  core_action: /$^/,
  payment:
    /\b(purchas\w+|buy\w*|pay(?:s|ing)?\s+for|top\s*s?\s*up|topping\s*up|check(?:s|ing)?\s*out|checkout|subscrib\w+|deposit\w*|complete[sd]?\s+the\s+paid)\b/i,
  account:
    /\b(sign\w*\s*up|signup|regist\w+|create[sd]?\s+an?\s+account|log\w*\s*in|login|sign\w*\s*in|complete[sd]?\s+the\s+account)\b/i,
  wallet:
    /\b(connect\w*\s+(?:their\s+|a\s+|the\s+|your\s+)?wallet|sign\w*\s+(?:the\s+)?transaction|complete[sd]?\s+the\s+wallet)\b/i,
  approval:
    /\b(approv\w+|authoriz\w+|authoris\w+|confirm\w*\s+the\s+transaction|complete[sd]?\s+the\s+approval)\b/i,
};

/** Is this action already covered by a mission that actually asks a tester to DO it? */
export function alreadyCovered(
  action: GatedAction,
  missions: readonly Pick<CandidateMission, "objective" | "criteria" | "title">[],
): boolean {
  if (action.family === "core_action" && action.objectNoun) {
    // covered only by a mission that asks a tester to DO the action to the founder's object — a
    // doing-verb and the object CLOSE TOGETHER ("create your agent", "launch an agent"), not merely
    // co-present anywhere in the text. The noun-regex trap, measured a THIRD time (clawup, live):
    // a homepage-comprehension mission that QUOTED the value-prop tagline "Build and Power Up Your AI
    // Agent" carried "build" and "agent" five words apart, so obj+verb-anywhere falsely marked the
    // real core-action mission "covered" and suppressed it. Proximity (verb, ≤2 words, object)
    // separates a DO instruction from a scattered tagline: "create your agent" matches; the tagline
    // (build … 4 words … agent) does not.
    const obj = action.objectNoun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const doPhrase = new RegExp(
      `\\b(?:launch|deploy|creat|build|start|run|mint|publish|generat)\\w*\\b(?:\\s+[\\w']+){0,2}\\s+\\b${obj}`,
      "i",
    );
    return missions.some((m) => doPhrase.test(`${m.title} ${m.objective} ${m.criteria.join(" ")}`));
  }
  const re = FAMILY_ACTION[action.family];
  return missions.some((m) => re.test(`${m.title} ${m.objective} ${m.criteria.join(" ")}`));
}

/**
 * Build the mission. The wording is fixed rather than generated because it has to satisfy
 * `classifyVerifiability` deterministically: it must read as reaching a URL and finding text, and
 * must contain none of the subjective language that would (correctly) push it to the observation
 * lane, where Sage has no corpus to judge it against.
 *
 * The tester is told plainly that they spend their own money, because they do, and a mission that
 * hides that is a mission people abandon halfway.
 */
export function buildGatedActionMission(
  action: GatedAction,
  opts: {
    targetSurface: string;
    productName?: string | null;
    /** A REAL cited observation. Defaulted from the target surface + the gate line Sage saw, because
     *  a mission citing nothing is refused by the validator — correctly, and silently. */
    sources?: SourceRef[];
    priority?: MissionPriority;
    index?: number;
  },
): CandidateMission {
  const noun = nounFor(action);
  const product = opts.productName && opts.productName !== "the product" ? opts.productName : "the product";
  const spends = action.family === "payment";

  return {
    missionKey: `gated-${action.family}${opts.index && opts.index > 0 ? `-${opts.index}` : ""}`,
    title: `Complete ${noun} and prove the result`,
    // REACHES_URL + FINDS_TEXT, no SUBJECTIVE terms. Checked by test, not by hope.
    objective: `Complete ${noun} in ${product} that the founder asked to have tested, then reach the page that confirms it and provide the url of that page along with the exact heading shown on it.`,
    instructions: [
      // MEASURED on the clawup.org run this mission exists for. The gate anchor is a line Sage read
      // on the page, so dropping it in bare produced "Start from simple, pay-as-you-go pricing." —
      // a heading spliced mid-sentence, reading as broken grammar and naming no destination. Quoting
      // it AS a label is what makes it usable: a tester can look for those words on the screen.
      `Start from the part of ${product} labelled "${action.gateAnchor}".`,
      // And say what is actually being bought. The old text said only "the paid step", so a tester
      // could not tell credits from a subscription from compute — on a mission that spends their own
      // money, and often the first English-language mission a beginner takes. The sentence naming the
      // step is already on this mission (whyItMatters); it just never reached the person doing the work.
      action.delegated
        ? `${product} describes this step as: "${action.sourcePhrase}".`
        : `The founder described this step in their own words: "${action.sourcePhrase}".`,
      `Carry ${noun} through to completion${spends ? " using your own payment method" : ""}.`,
      "When it finishes, stay on the page that confirms the result.",
      "Give the url of that page and copy the exact heading or line of text on it that shows the result.",
      spends
        ? "This mission asks you to spend your own money. Only take it if you are willing to do that."
        : "Use your own account details. Do not share passwords or private keys with anyone.",
    ].join(" "),
    targetSurface: opts.targetSurface,
    criteria: [
      `The tester reaches the page that confirms ${noun} completed, and the destination page contains a heading or line of text showing the result.`,
      "The url provided is a page in the product that displays that result text.",
    ],
    evidenceRequirements: [
      "The url of the page shown after the step completed.",
      "The exact heading or line of text on that page that shows the result.",
      // THE QUESTIONS ONLY LIVED EXPERIENCE ANSWERS. Sage cannot walk through this gate, so its
      // judge verifies the tester's words against what the product's own documentation says is
      // behind it (the doc-fed private key) plus the account's coherence. A copy-paste of the
      // mission text scores nothing; naming the actual screens, in order, with their real labels,
      // is what a person who genuinely did it writes without trying.
      `In your own words: what did the screen show immediately after ${noun} completed? Name the first thing you could do next, using the exact label shown.`,
      "Which step tripped you up or took longest, and what did the product call it on screen?",
    ],
    whyItMatters: action.delegated
      ? `This is ${product}'s core action — what a first-time visitor signs up to do ("${action.sourcePhrase}"). No goal was given, so Sage chose the thing the product is actually for. Sage can see where it begins but must never sign up or act on anyone's behalf, so this is the part only a person can carry out.`
      : `The founder asked for this specifically: "${action.sourcePhrase}". Sage can see where it begins but must never pay, sign, or register on anyone's behalf, so this is the part only a person can carry out.`,
    // EVERY MISSION MUST CITE SOMETHING SAGE OBSERVED, and this one nearly shipped citing nothing.
    // Built correctly, anchored correctly, and then dropped by the validator with
    // `unknown_source_ref` — in silence, exactly as the drop is designed to behave. So on clawup.org
    // the gate was detected, the mission was constructed, and it vanished before the founder saw it.
    // The gate line IS the observation: Sage read those words on that page.
    sources: opts.sources ?? [
      { kind: "page", ref: opts.targetSurface, observation: action.gateAnchor },
    ],
    priority: opts.priority ?? "high",
    // The category the gate itself belongs to — payment and wallet steps are literally this.
    riskCategory:
      action.family === "payment" || action.family === "wallet"
        ? "wallet_payment"
        : action.family === "account"
          ? "onboarding"
          : "critical_journey",
    effortMinutes: FAMILY_EFFORT[action.family],
    conditions: spends
      ? ["A payment method the tester is willing to use", "Their own account on the product"]
      : ["Their own account on the product"],
    // Harder work, weighted higher, so the deterministic compiler pays it more per tester.
    rewardWeight: 8,
    // MORE THAN ONE PERSON SHOULD PROVE A PAID FLOW. One tester is a single data point on the most
    // expensive thing a founder asked about, and this mission is high-priority so the compiler makes
    // it the balancer — with a cap of 1 it absorbed the entire remainder into one reward ($118.62 on
    // a $430 clawup run, which is the leftover rather than a judgement about the work).
    //
    // Three is deliberately modest: each tester spends their own money here, so this is not a mission
    // to fan out widely, and the effort-anchored policy still reduces it when the pot cannot pay three
    // fairly.
    maxCompletions: 3,
    verificationMethod:
      "Sage judges the account against the product's own documentation of what lies behind this gate (its doc-fed private key) plus the coherence of a lived, in-order description — a URL behind auth cannot be fetched, so the tester's words carry the proof.",
    confidence: 0.9,
    anchors: [action.gateAnchor],
    assumptions: [
      `The tester has, or is willing to obtain, whatever ${noun} requires. Sage cannot verify that in advance.`,
    ],
    // The boundaries Sage holds itself to, restated for the person doing the work.
    disallowed: [
      "Sharing passwords, private keys, or recovery phrases with anyone, including Sage",
      "Spending more than the step itself requires",
    ],
  };
}
