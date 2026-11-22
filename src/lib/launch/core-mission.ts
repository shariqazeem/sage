import { detectInjection } from "@/lib/deputy/brain-core";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import type { CandidateMission, FieldTestSummary, MissionPriority, MissionValidationReport, ProductMapV1, SourceRef } from "./schemas";
import { anchorIssues, classifyVerifiability, validatePlanMissions, type ValidationScope } from "./validate-mission";
import { kindFallbackName, kindOfMap, kindProofIssue, playbookOf, type ProductKind } from "./product-kind";

/**
 * THE CORE MISSION: the three things every builder needs to know, on every test (21 Nov 2026).
 *
 * The missions the architect designs prove a stranger can click through a flow. They do not say
 * whether a stranger UNDERSTOOD the product, how far they got with the one thing it is for, or
 * whether they would come back. So every test also carries one mission that asks exactly that:
 *
 *   1. First impression: before clicking, one sentence on what this is and who it is for, plus one
 *      detail from the first screen that is only known by looking.
 *   2. The main action: try the one thing the product exists for, and say where you finished or
 *      stopped and what stopped you, naming the screen.
 *   3. The honest verdict: would you use it again, and what would make you.
 *
 * HOW IT IS BUILT. The WORDS are fixed here, in code, because they have to pass the deterministic
 * gate every time and must never promise what Sage cannot check. A model contributes exactly two
 * short values that make it this product's mission and not a template:
 *   - `mainAction`: the one thing this product is for, as a short verb phrase ("start a drop");
 *   - `startsAt`: the verbatim words of the observed control where it begins.
 * Both are checked (`coerceCoreHint`): plain words only, no link, no instruction, and `startsAt` must
 * be something Sage really observed. When the model gives nothing usable, the same two values are
 * read from the missions the gate already accepted, then from the product's own first button, and
 * last from a sentence that fits any product. So the core mission never depends on a model.
 *
 * WHY THE VERIFICATION STAYS STRONG. The built mission goes through `validatePlanMissions`, the same
 * gate as every model-written mission: scope, cited sources, safety, injection, evidence Sage can
 * check, the anchor gate. It is observation-based by construction, so it is judged against what Sage
 * saw itself, with the private key the tester never sees; nothing here loosens that judge. It is paid
 * for an honest try whether or not the person finished: the criteria ask them to NAME where they
 * stopped, never to succeed.
 *
 * EVERY KIND OF PRODUCT (22 Nov 2026). A site is tried in a browser; a phone app is installed, a bot is started,
 * a README is followed. For each kind Sage cannot open like a site, the same mission is written with that kind's
 * own fixed words (`product-kind.ts`): the tester first reads what Sage read (the store listing, the bot's page,
 * the README), then tries the product where it lives. The answer is still judged against what Sage read, and the
 * verification line says plainly that Sage could not use the product itself. An ordinary website's mission is
 * word for word what it was.
 */

export interface CoreHint {
  /** the one thing this product is for, as a lowercase verb phrase: "start a drop" */
  mainAction: string;
  /** the verbatim observed words of the control where it starts, or null */
  startsAt: string | null;
  /** where the hint came from, for the record */
  from: "model" | "accepted-mission" | "primary-cta" | "heading" | "first-button" | "generic";
}

/**
 * The first screen as the static read saw it, for a run with no browser: the landing page's title, headings and
 * calls to action. Handing it to the ladder also switches on the two rungs that need no model (see
 * `coreHintLadder`), so it is passed only where no model answered.
 */
export interface FirstScreen {
  productName?: string | null;
  title?: string | null;
  headings?: readonly string[];
  ctas?: readonly string[];
}

export const GENERIC_ACTION = "do the main thing this product is for";
const ACTION_MIN = 6;
const ACTION_MAX = 72;
const ACTION_MAX_WORDS = 10;

/** A first word that makes the phrase something a person DOES. */
const DOING_VERB =
  /^(start|create|make|build|send|post|publish|write|add|open|find|search|play|try|use|book|browse|explore|join|sign up|register|set up|run|launch|deploy|draw|upload|share|invite|connect|pick|choose|select|compare|filter|follow|complete|finish|take|watch|listen|generate|design|plan|track|check|get|give|ask|talk|chat|download|install|enter|fill|submit|view|reach|walk|schedule|record|edit|save|import|export|scan|learn|configure|customi[sz]e)\b/i;
/** Things the core mission must never send a stranger to do, whatever a model suggests. */
const NEVER =
  /\b(buy|purchase|pay|checkout|subscribe|deposit|withdraw|transfer|bridge|swap|stake|mint|sign (a|the|any) (transaction|message)|private key|seed phrase|password|delete|hack|exploit)\b/i;
const NAV_WORDS = /^(home|about|pricing|docs?|documentation|blog|contact|faq|help|support|terms|privacy|log ?in|sign ?in|login|menu|close|back|next|skip|accept|ok|careers|press|legal|cookie.*|english|en)$/i;

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
const observed = (text: string, corpus: string): boolean => text.trim().length >= 3 && anchorIssues({ anchors: [text] }, corpus).length === 0;

/** A phrase a mission may carry as its main action: plain, short, something a person does, and safe. */
export function usableAction(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = squash(raw.replace(/https?:\/\/\S+/gi, " ").replace(/[^\p{L}\p{N} '’\-&/]/gu, " "));
  s = s.replace(/^(to|try to|please)\s+/i, "");
  if (s.length < ACTION_MIN || s.length > ACTION_MAX) return null;
  if (s.split(" ").length > ACTION_MAX_WORDS) return null;
  if (!DOING_VERB.test(s) || NEVER.test(s)) return null;
  if (detectInjection(s).length > 0) return null;
  return s[0]!.toLowerCase() + s.slice(1);
}

/**
 * The model's hint, checked. `raw` is the architect's whole answer; the hint lives under "core".
 * Null when there is none or it is unusable: the caller falls back, it never repairs.
 */
export function coerceCoreHint(raw: unknown, corpus: string): CoreHint | null {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const core = root?.core && typeof root.core === "object" && !Array.isArray(root.core) ? (root.core as Record<string, unknown>) : null;
  if (!core) return null;
  const mainAction = usableAction(core.mainAction);
  if (!mainAction) return null;
  const starts = typeof core.startsAt === "string" ? squash(core.startsAt) : "";
  // words Sage never observed are dropped, not trusted: the mission then names no starting point
  return { mainAction, startsAt: starts && starts.length <= 80 && observed(starts, corpus) ? starts : null, from: "model" };
}

/**
 * WHERE THE CORE STANDS, DECIDED FOR THIS BUILDER (21 Nov 2026, the founder: "according to budget or anything, the
 * agent should be intelligent enough to make decisions which are good for the purpose they most likely came for").
 *
 * The core mission used to be ranked by a fixed rule: first on a legacy plan, and on a grounded plan only where it
 * displaced nothing. Now the architect reads what this builder most likely came for (their words, who it is for,
 * the product's stage, and roughly how many answers the budget buys) and ranks it:
 *   - "lead": the core is what they need most (whether strangers get it, how far a first visitor gets);
 *   - "alongside": they named flows AND want first impressions;
 *   - "yield": they named one flow or fix to test, and on a tight budget the money should go there first.
 * The rank becomes the core's PRIORITY, and the frozen allocator does the rest: which missions a budget funds, and
 * every amount. So the model decides WHERE, never HOW MUCH (CLAUDE.md, the operator invariant). Its two sentences
 * are shown to the builder as Sage's read, checked first: plain words, no link, no instruction.
 */
export type CoreRank = "lead" | "alongside" | "yield";
export const CORE_RANKS: readonly CoreRank[] = ["lead", "alongside", "yield"];

export interface CoreDecision {
  rank: CoreRank;
  /** one plain sentence: what this builder most likely came to Sage for, or null */
  purpose: string | null;
  /** one short reason for the rank, pointing at their words or the product, or null */
  why: string | null;
  /** "default" when the architect gave no usable rank: the old rule, the core leads */
  from: "model" | "default";
}

export const DEFAULT_CORE_DECISION: CoreDecision = { rank: "lead", purpose: null, why: null, from: "default" };

/** The rank as the allocator reads it. */
export const CORE_PRIORITY: Record<CoreRank, MissionPriority> = { lead: "high", alongside: "medium", yield: "low" };

/** The rank in a builder's words, for the live trail and the page. */
export const CORE_RANK_WORDS: Record<CoreRank, string> = {
  lead: "it comes first",
  alongside: "it sits beside the flows you named",
  yield: "the flow you named comes first",
};

const PURPOSE_MAX = 200;
const WHY_MAX = 180;

/** A sentence Sage may show a builder as its own words: plain, short, no link, no markup, no instruction. */
function plainSentence(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = squash(raw.replace(/https?:\/\/\S+/gi, " ").replace(/[<>{}[\]`*_#|\\]/g, " "));
  if (s.length < 12 || s.length > max || !/\p{L}{3,}/u.test(s)) return null;
  if (detectInjection(s).length > 0) return null;
  return s;
}

/**
 * The architect's decision about the core, checked. `raw` is its whole answer; the decision lives under "core".
 * A rank that is not one of the three is no decision at all (the old rule stands); a sentence that fails the
 * check is dropped, never repaired.
 */
export function coerceCoreDecision(raw: unknown): CoreDecision {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const core = root?.core && typeof root.core === "object" && !Array.isArray(root.core) ? (root.core as Record<string, unknown>) : null;
  if (!core) return DEFAULT_CORE_DECISION;
  const said = typeof core.rank === "string" ? core.rank.trim().toLowerCase() : "";
  const rank = (CORE_RANKS as readonly string[]).includes(said) ? (said as CoreRank) : null;
  if (!rank) return DEFAULT_CORE_DECISION;
  return { rank, purpose: plainSentence(core.purpose, PURPOSE_MAX), why: plainSentence(core.why, WHY_MAX), from: "model" };
}

type Accepted = Pick<CandidateMission, "title" | "priority" | "riskCategory" | "anchors">;

/** The first screen's controls, in the order Sage met them: the browser's, then the static read's. */
function firstControls(ft: FieldTestSummary | null | undefined, screen?: FirstScreen | null): string[] {
  return [
    ...(ft?.pages?.[0]?.ctas ?? []),
    ...((ft?.states?.[0]?.notableElements ?? []).filter((e) => /button|link|^a$/i.test(`${e.tag} ${e.role}`)).map((e) => e.text)),
    ...(screen?.ctas ?? []),
  ];
}

const STOP = new Set(["the", "and", "for", "with", "your", "this", "that", "from", "into", "onto", "after", "before", "first", "new", "get", "use", "try", "open", "start", "make"]);
const realWords = (s: string): Set<string> => new Set((s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)));

/**
 * A starting point must be where the action starts. Measured on excalidraw: asked for one, the model paired "save to a
 * local file" with an "Open Ctrl+O" button, which would send every tester the wrong way. So it is kept only when it
 * shares a real word with the action; otherwise the mission names no starting point, which is always true.
 */
export function startsWhereItSays(hint: CoreHint | null): CoreHint | null {
  if (!hint?.startsAt) return hint;
  const action = realWords(hint.mainAction);
  const shared = [...realWords(hint.startsAt)].some((w) => action.has(w));
  return shared ? hint : { ...hint, startsAt: null };
}

/**
 * THE MAIN ACTION WITH NO MODEL (22 Nov 2026). When no model answers, a website's first-try mission still has
 * to name what a stranger should try. Two rungs read it from the product's own words, before the sentence that
 * fits anything:
 *   1. the primary call to action: the first control on the first screen whose label is itself something a
 *      person does ("Start a drop"). The tester starts from that very control, so the starting point is right
 *      by construction. A label that only opens a door ("Get started", "Sign up", "Learn more", "Pricing")
 *      names no action and is left to the old first-button rung;
 *   2. the heading's verb: the first heading, or a part of it, that reads as something a person does ("Send a
 *      gift to anyone"). It names a starting control only when one shares a real word with it. A slogan is not
 *      an action ("Build faster", "Start growing your business today"): a heading of fewer than three words,
 *      or one that promises instead of naming a thing to do, is passed over.
 * Both pass `usableAction` (plain, short, safe, no instruction), and the mission they make faces the same gate.
 */
const DOOR_ONLY =
  /^(get started|start( now| free| for free| here| today)?|sign up( free| for free| now| today)?|register( now)?|join( now| free| us)?|try( it)?( now| free| for free| out)?|launch( the)? app|open( the)? app|enter( the)? app|go to( the)? app|use( the)? app|create( an| your)? account|get( the)? app|download( now)?|install( now)?|continue|explore|learn more|read more|see more|find out more|watch( the)? (demo|video)|get( a)? demo|book( a)? (demo|call)|request( a)? demo|talk to (sales|us)|contact( us| sales)?|view (pricing|plans|docs)|(see|compare|choose) (pricing|plans|a plan)|get in touch|follow us|share)$/i;
const NOT_THE_PRODUCT = /\b(pricing|demo|sales|docs?|documentation|blog|newsletter|github|twitter|discord|telegram|linkedin|youtube|cookies?|privacy|terms|log ?in|sign ?in|careers|press)\b/i;

const SLOGAN =
  /\b(faster|better|smarter|easier|simpler|effortless(ly)?|seamless(ly)?|instantly|in (seconds|minutes)|today|now|business|productivity|workflows?|future|world|everything|anything|more|10x|supercharge|unlock|revenue|growth|at scale|next level|like never before|without the|the smart way)\b/i;

/** The action in sentence case: a button's Title Case reads wrong mid-sentence. The product's own name and short capitals stay. */
function midSentence(action: string, productName: string | null | undefined): string {
  const own = new Set((productName ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return action
    .split(" ")
    .map((w, i) => ((i > 0 && own.has(w.toLowerCase())) || /^[\p{Lu}\p{N}]{2,5}$/u.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

export function primaryCallToAction(ft: FieldTestSummary | null | undefined, screen: FirstScreen | null | undefined, corpus: string): CoreHint | null {
  for (const raw of firstControls(ft, screen)) {
    const label = squash(raw ?? "");
    if (label.length < 6 || label.length > 40 || NAV_WORDS.test(label) || DOOR_ONLY.test(label) || NOT_THE_PRODUCT.test(label)) continue;
    const action = usableAction(label);
    if (!action || action.split(" ").length < 2 || !observed(label, corpus)) continue;
    return { mainAction: midSentence(action, screen?.productName), startsAt: label, from: "primary-cta" };
  }
  return null;
}

export function headingAction(ft: FieldTestSummary | null | undefined, screen: FirstScreen | null | undefined, corpus: string): CoreHint | null {
  const page = ft?.pages?.[0];
  const headings = [page?.h1 ?? "", ...(screen?.headings ?? []).slice(0, 3), page?.title ?? "", screen?.title ?? ""];
  for (const raw of headings) {
    const heading = squash(raw);
    if (!heading) continue;
    for (const part of [heading, ...heading.split(/\s*[:|·.!?—–]\s*|\s+-\s+/)]) {
      if (DOOR_ONLY.test(squash(part)) || NOT_THE_PRODUCT.test(part)) continue;
      const action = usableAction(part);
      if (!action || action.split(" ").length < 3 || SLOGAN.test(action)) continue;
      const mainAction = midSentence(action, screen?.productName);
      // a starting control only when it is where this action starts (it shares a real word with it)
      const start = firstControls(ft, screen)
        .map((c) => squash(c ?? ""))
        .find((c) => c.length >= 3 && c.length <= 40 && !NAV_WORDS.test(c) && !NEVER.test(c) && observed(c, corpus) && !!startsWhereItSays({ mainAction, startsAt: c, from: "heading" })?.startsAt);
      return { mainAction, startsAt: start ?? null, from: "heading" };
    }
  }
  return null;
}

function firstButton(ft: FieldTestSummary | null | undefined, corpus: string, screen?: FirstScreen | null): string | null {
  const labels = firstControls(ft, screen);
  for (const raw of labels) {
    const label = squash(raw ?? "");
    if (label.length < 3 || label.length > 40 || NAV_WORDS.test(label) || NEVER.test(label)) continue;
    if (!/\p{L}{3,}/u.test(label) || detectInjection(label).length > 0) continue;
    if (observed(label, corpus)) return label;
  }
  return null;
}

/**
 * Every hint worth trying, best first: the model's own, then the title of the most important accepted
 * mission that reads as something a person does, then the product's first button, then the sentence
 * that fits anything. The gate picks the first one whose mission it accepts.
 */
export function coreHintLadder(model: CoreHint | null, accepted: readonly Accepted[], map: Pick<ProductMapV1, "fieldTest">, corpus: string, kind: ProductKind = "website", screen?: FirstScreen | null): CoreHint[] {
  const out: CoreHint[] = [];
  // the sentence that fits any product of this kind: "start it and use its main command" for a bot
  const generic = playbookOf(kind).firstTry?.defaultAction ?? GENERIC_ACTION;
  if (model) out.push(model);
  const rank = (m: Accepted) => (m.riskCategory === "critical_journey" ? 0 : m.riskCategory === "onboarding" ? 1 : 2) * 3 + (m.priority === "high" ? 0 : m.priority === "medium" ? 1 : 2);
  for (const m of [...accepted].sort((a, b) => rank(a) - rank(b))) {
    const action = usableAction(m.title);
    if (!action) continue;
    const start = (m.anchors ?? []).map(squash).find((a) => a.length <= 40 && !NAV_WORDS.test(a) && observed(a, corpus)) ?? null;
    out.push({ mainAction: action, startsAt: start, from: "accepted-mission" });
    break;
  }
  // with no model (a first screen is handed in): the product's own call to action, then its heading's verb.
  // A kind with its own first try keeps that kind's default: its words say how a person tries it.
  if (screen && !playbookOf(kind).firstTry) {
    const cta = primaryCallToAction(map.fieldTest, screen, corpus);
    if (cta) out.push(cta);
    const heading = headingAction(map.fieldTest, screen, corpus);
    if (heading) out.push(heading);
  }
  const button = firstButton(map.fieldTest, corpus, screen);
  if (button) out.push({ mainAction: generic, startsAt: button, from: "first-button" });
  out.push({ mainAction: generic, startsAt: null, from: "generic" });
  return out;
}

/** Two to four verbatim things Sage observed on the way in: where it starts, and the first screen's own words. */
export function coreAnchors(map: Pick<ProductMapV1, "fieldTest" | "productKind">, corpus: string, startsAt: string | null, screen?: FirstScreen | null): string[] {
  const ft = map.fieldTest;
  const page = ft?.pages?.[0];
  const first = ft?.states?.[0];
  const pool = [
    startsAt ?? "",
    page?.h1 ?? "",
    page?.title ?? "",
    ...(first?.visibleTextExcerpt ?? "").split("\n").slice(0, 6),
    ...(page?.visibleTextExcerpt ?? "").split("\n").slice(0, 6),
    ...(page?.ctas ?? []).slice(0, 3),
    // what Sage read on the product's page when no browser ran (a listing read as plain HTML)
    ...(map.productKind?.seen ?? []),
    // ...and the landing page's own words, on a website read with no browser and no model
    ...(screen?.headings ?? []).slice(0, 3),
    screen?.title ?? "",
    ...(screen?.ctas ?? []).slice(0, 3),
  ];
  const out: string[] = [];
  for (const raw of pool) {
    const a = squash(raw);
    if (a.length < 4 || a.length > 90 || out.some((x) => x.toLowerCase() === a.toLowerCase())) continue;
    if (observed(a, corpus)) out.push(a);
    if (out.length >= 4) break;
  }
  return out;
}

function nameOf(productName: string | null | undefined, host: string): string {
  const n = squash(productName ?? "");
  return n && n.length <= 40 && !/[()]/.test(n) && !/^(the )?product$/i.test(n) ? n : host;
}

export interface CoreContext {
  productName: string | null;
  /** the product's entry address: one the validator knows Sage inspected */
  targetSurface: string;
  anchors: string[];
  sources: SourceRef[];
}

/** The mission itself. Fixed words; the product's name, its main action and its starting point are the only moving parts. */
export function buildCoreMission(hint: CoreHint, ctx: CoreContext, rank: CoreRank = "lead", kind: ProductKind = "website"): CandidateMission {
  const words = playbookOf(kind).firstTry;
  if (words) return buildKindFirstTry(hint, ctx, rank, kind);
  let host = ctx.targetSurface;
  try {
    host = new URL(ctx.targetSurface).hostname.replace(/^www\./, "");
  } catch {
    /* the address stands */
  }
  const product = nameOf(ctx.productName, host);
  const action = hint.mainAction;
  const from = hint.startsAt ? `, starting from “${hint.startsAt}”` : "";
  return {
    missionKey: CORE_MISSION_KEY,
    title: `Try ${product} for the first time and say how far you got`,
    objective: `Open ${product} as a first-time visitor, say what you take it to be, then try to ${action} and report how far you got and what stopped you.`,
    instructions: [
      `1. Open ${ctx.targetSurface} and look at the first screen for about ten seconds. Do not click anything yet.`,
      `2. Decide, from that screen alone, what ${product} is and who it is for. Note one thing on it you could only know by looking: the words of a heading, a button or a label.`,
      `3. Now try to ${action}${from}. Go as far as you can. If it asks for money, a wallet approval or an account you do not want to make, stop there: that counts as where you stopped.`,
      `4. When you finish or get stuck, note the name of the screen or the words on the last button you used, and what stopped or confused you.`,
      `5. Answer the four questions in your own words. An honest "I got stuck here" earns the same as "I finished".`,
    ].join("\n"),
    targetSurface: ctx.targetSurface,
    criteria: [
      `The answer says in one sentence what the tester took ${product} to be and who it is for, from the first screen.`,
      `The answer names one specific thing from the first screen that matches what Sage saw there.`,
      `The answer names the screen or button where the tester finished or stopped while trying to ${action}, and what happened there.`,
      `The answer says whether the tester would use ${product} again and what would change that.`,
    ],
    evidenceRequirements: [
      `Before clicking anything: in one sentence, what is ${product} and who is it for?`,
      `What is one thing on the first screen that you only know by looking at it (the words of a heading, a button or a label)?`,
      `You tried to ${action}. Which screens did you pass, where did you finish or stop, and what stopped or confused you? Name the last screen or button.`,
      `Would you use ${product} again? What would make you?`,
    ],
    whyItMatters: `A builder cannot see their own product for the first time. This asks every tester the three things only a stranger can answer: what they took ${product} to be, how far they got trying to ${action}, and whether they would come back.`,
    sources: ctx.sources,
    // the architect's rank for THIS builder (lead, alongside, yield); the allocator turns it into what is funded
    priority: CORE_PRIORITY[rank],
    riskCategory: "onboarding",
    effortMinutes: 8,
    conditions: ["A phone or a computer with a normal browser", "No account needed to begin"],
    rewardWeight: 6,
    maxCompletions: 5,
    verificationMethod:
      "Sage judges the tester's own account against what it observed itself on the same screens during its run: the detail from the first screen and the screens named on the way must match things Sage saw. The answer is paid for being a real, specific try, whether or not the tester finished.",
    confidence: 0.8,
    assumptions: [],
    disallowed: ["Do not pay for anything", "Do not approve a wallet request", "Do not share a password or a recovery phrase"],
    anchors: ctx.anchors,
  };
}

/**
 * The first-try mission for a kind Sage cannot open like a site. Same four questions, same order, same gate;
 * the words say where the tester reads first (what Sage read) and how a person tries this kind of product.
 */
function buildKindFirstTry(hint: CoreHint, ctx: CoreContext, rank: CoreRank, kind: ProductKind): CandidateMission {
  const book = playbookOf(kind);
  const t = book.firstTry!;
  let host = ctx.targetSurface;
  try {
    host = new URL(ctx.targetSurface).hostname.replace(/^www\./, "");
  } catch {
    /* the address stands */
  }
  const product = nameOf(ctx.productName, host);
  const action = hint.mainAction;
  const from = hint.startsAt ? `, starting from “${hint.startsAt}”` : "";
  const stranger = "A builder cannot see their own product for the first time.";
  return {
    missionKey: CORE_MISSION_KEY,
    title: `Try ${product} for the first time and say how far you got`,
    objective: `Read ${t.place} of ${product}, say what you take it to be, then try to ${action} and report how far you got and what stopped you.`,
    instructions: [
      `1. Open ${ctx.targetSurface} and ${t.look}`,
      `2. Decide, from ${t.place} alone, what ${product} is and who it is for. Note one thing there you could only know by looking: the words of a heading, a button or a line of its description.`,
      `3. ${t.how(product, action, from)} Go as far as you can. ${t.stop}`,
      `4. When you finish or get stuck, note ${t.last}, and what stopped or confused you.`,
      `5. Answer the four questions in your own words. An honest "I got stuck here" earns the same as "I finished".`,
    ].join("\n"),
    targetSurface: ctx.targetSurface,
    criteria: [
      `The answer says in one sentence what the tester took ${product} to be and who it is for, from ${t.place}.`,
      `The answer names one specific thing from ${t.place} that matches what Sage read there.`,
      `The answer names ${t.where} where the tester finished or stopped while trying to ${action}, and what happened there.`,
      `The answer says whether the tester would use ${product} again and what would change that.`,
    ],
    evidenceRequirements: [
      `Before trying it: in one sentence, what is ${product} and who is it for?`,
      `What is one thing on ${t.place} that you only know by looking at it (the words of a heading, a button or a line of its description)?`,
      `You tried to ${action}. What did you do, where did you finish or stop, and what stopped or confused you? Name ${t.last}.`,
      `Would you use ${product} again? What would make you?`,
    ],
    whyItMatters: `${stranger} This asks every tester the three things only a stranger can answer: what they took ${product} to be, how far they got trying to ${action}, and whether they would come back.`,
    sources: ctx.sources,
    priority: CORE_PRIORITY[rank],
    riskCategory: "onboarding",
    effortMinutes: t.minutes,
    conditions: t.conditions,
    rewardWeight: 6,
    maxCompletions: 5,
    // said plainly: what Sage read, what it could not do, and what the answer is therefore checked against
    verificationMethod: `${book.honesty} So Sage judges the tester's own account against ${t.place} as it read it: the detail named from it must match what Sage read, and the account of the try must be specific and fit what ${t.place} says ${product} does. The answer is paid for being a real, specific try, whether or not the tester finished.`,
    confidence: 0.7,
    assumptions: [],
    disallowed: t.disallowed,
    anchors: ctx.anchors,
  };
}

export interface CoreAdded {
  mission: CandidateMission;
  hint: CoreHint;
  report: MissionValidationReport;
}

/**
 * Build the core mission for this plan and put it through the gate. Tries each hint in the ladder and
 * returns the first mission the gate accepts beside the missions already accepted (so the cross-plan
 * rules, unique keys and distinct objectives, hold too). Null when no version passes: a plan without
 * its core is better than a plan with a mission Sage cannot stand behind.
 */
export function addCoreMission(input: {
  map: Pick<ProductMapV1, "productName" | "fieldTest" | "observations" | "productKind">;
  productUrl: string;
  scope: ValidationScope;
  corpus: string;
  accepted: readonly CandidateMission[];
  modelHint: CoreHint | null;
  /** where the core stands for this builder; absent, the old rule (it leads) */
  decision?: CoreDecision;
  /**
   * Only where no model answered and this mission is the whole plan: the landing page as the static read saw
   * it. It switches on the ladder's two model-free rungs and lends the mission its anchors on a run with no
   * browser. Absent everywhere else, where the ladder and the anchors are exactly what they were.
   */
  firstScreen?: FirstScreen | null;
}): CoreAdded | null {
  const { map, scope, corpus, accepted } = input;
  if (accepted.some((m) => m.missionKey === CORE_MISSION_KEY)) return null;
  const targetSurface = [...scope.knownUrls].find((u) => u === input.productUrl) ?? input.productUrl;
  const sources: SourceRef[] = scope.knownUrls.has(targetSurface)
    ? [{ kind: "page", ref: targetSurface, observation: "The first screen Sage opened, and where a first-time visitor starts." }]
    : [{ kind: "founder", ref: "goal", observation: "The builder asked for this product to be tried by people." }];
  const kind = kindOfMap(map);
  // A product's own NAME can trip the gate: a prototype called "Checkout flow" reads, inside the fixed words, as
  // an instruction to check out. Where the kind has its own first try (which may be the whole plan), the mission
  // is then written once more with a plain noun for the kind ("this prototype"). A website is tried once, as before.
  // ...and where the mission stands alone because no model answered: it is then the whole plan for a website too.
  const screen = input.firstScreen ? { ...input.firstScreen, productName: input.firstScreen.productName ?? map.productName } : null;
  const names = playbookOf(kind).firstTry || screen ? [map.productName, kindFallbackName(kind)] : [map.productName];
  for (const productName of names) {
    for (const hint of coreHintLadder(input.modelHint, accepted, map, corpus, kind, screen)) {
      const mission = buildCoreMission(hint, { productName, targetSurface, anchors: coreAnchors(map, corpus, hint.startsAt, screen), sources }, (input.decision ?? DEFAULT_CORE_DECISION).rank, kind);
      const reports = validatePlanMissions([...accepted, mission], scope, corpus, map.observations);
      const report = reports[reports.length - 1]!;
      // the kind's own rule too: the first try is the tester's account, never a page-and-quote check
      if (report.ok && kindProofIssue(mission, kind, classifyVerifiability(mission)) === null) return { mission: { ...mission, verifiabilityClass: classifyVerifiability(mission) }, hint, report };
    }
  }
  return null;
}
