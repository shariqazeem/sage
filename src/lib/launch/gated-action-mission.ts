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
 *   3. VERIFIED BY AN ARTIFACT, NOT BY SAGE'S MEMORY. Sage has no corpus for a screen it never
 *      loaded, so an observation-based mission here would be unjudgeable. These are url-verifiable:
 *      the tester supplies a reachable page and quotes text from it, which the payout lane fetches
 *      and checks. That is the one verification route that works for something Sage did not witness.
 */

/** A boundary Sage must not cross. Mirrors `intent-guard`'s families, which is the point: the same
 *  actions that must never be INVENTED are the ones that must be PLANNED when genuinely requested. */
export type GatedFamily = "payment" | "account" | "wallet" | "approval";

const FAMILY_PATTERNS: { family: GatedFamily; re: RegExp }[] = [
  {
    family: "payment",
    re: /\b(purchas\w+|buy(?:ing)?|pay(?:ment|ing|s)?|paid|checkout|billing|credits?|top\s*up|subscri\w+|deposit)\b/i,
  },
  {
    family: "account",
    re: /\b(sign\s*up|signup|register\w*|create\s+an?\s+account|log\s*in|login|sign\s*in)\b/i,
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
};

/** Plain words for the mission text. Never a model's phrasing — this text has to pass a regex gate. */
const FAMILY_NOUN: Record<GatedFamily, string> = {
  payment: "the paid step",
  account: "the account step",
  wallet: "the wallet step",
  approval: "the approval step",
};

export interface GatedAction {
  family: GatedFamily;
  /** the founder's own words that asked for this. Verbatim — never paraphrased, never invented. */
  sourcePhrase: string;
  /** observed text marking the gate. A literal substring of the corpus, so the mission anchors. */
  gateAnchor: string;
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
  return out;
}

/** Is this action already covered by a mission the architect wrote? Cheap, lexical, conservative. */
export function alreadyCovered(
  action: GatedAction,
  missions: readonly Pick<CandidateMission, "objective" | "criteria" | "title">[],
): boolean {
  const re = FAMILY_PATTERNS.find((f) => f.family === action.family)!.re;
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
  const noun = FAMILY_NOUN[action.family];
  const product = opts.productName && opts.productName !== "the product" ? opts.productName : "the product";
  const spends = action.family === "payment";

  return {
    missionKey: `gated-${action.family}${opts.index && opts.index > 0 ? `-${opts.index}` : ""}`,
    title: `Complete ${noun} and prove the result`,
    // REACHES_URL + FINDS_TEXT, no SUBJECTIVE terms. Checked by test, not by hope.
    objective: `Complete ${noun} in ${product} that the founder asked to have tested, then reach the page that confirms it and provide the url of that page along with the exact heading shown on it.`,
    instructions: [
      `Start from ${action.gateAnchor}.`,
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
    ],
    whyItMatters: `The founder asked for this specifically: "${action.sourcePhrase}". Sage can see where it begins but must never pay, sign, or register on anyone's behalf, so this is the part only a person can carry out.`,
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
      "Sage fetches the url the tester provides and checks that the quoted text is really on that page.",
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
