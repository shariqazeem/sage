import { detectInjection } from "@/lib/deputy/brain-core";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import type { CandidateMission, FieldTestSummary, MissionValidationReport, ProductMapV1, SourceRef } from "./schemas";
import { anchorIssues, classifyVerifiability, validatePlanMissions, type ValidationScope } from "./validate-mission";

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
 */

export interface CoreHint {
  /** the one thing this product is for, as a lowercase verb phrase: "start a drop" */
  mainAction: string;
  /** the verbatim observed words of the control where it starts, or null */
  startsAt: string | null;
  /** where the hint came from, for the record */
  from: "model" | "accepted-mission" | "first-button" | "generic";
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

type Accepted = Pick<CandidateMission, "title" | "priority" | "riskCategory" | "anchors">;

function firstButton(ft: FieldTestSummary | null | undefined, corpus: string): string | null {
  const labels = [
    ...(ft?.pages?.[0]?.ctas ?? []),
    ...((ft?.states?.[0]?.notableElements ?? []).filter((e) => /button|link|^a$/i.test(`${e.tag} ${e.role}`)).map((e) => e.text)),
  ];
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
export function coreHintLadder(model: CoreHint | null, accepted: readonly Accepted[], map: Pick<ProductMapV1, "fieldTest">, corpus: string): CoreHint[] {
  const out: CoreHint[] = [];
  if (model) out.push(model);
  const rank = (m: Accepted) => (m.riskCategory === "critical_journey" ? 0 : m.riskCategory === "onboarding" ? 1 : 2) * 3 + (m.priority === "high" ? 0 : m.priority === "medium" ? 1 : 2);
  for (const m of [...accepted].sort((a, b) => rank(a) - rank(b))) {
    const action = usableAction(m.title);
    if (!action) continue;
    const start = (m.anchors ?? []).map(squash).find((a) => a.length <= 40 && !NAV_WORDS.test(a) && observed(a, corpus)) ?? null;
    out.push({ mainAction: action, startsAt: start, from: "accepted-mission" });
    break;
  }
  const button = firstButton(map.fieldTest, corpus);
  if (button) out.push({ mainAction: GENERIC_ACTION, startsAt: button, from: "first-button" });
  out.push({ mainAction: GENERIC_ACTION, startsAt: null, from: "generic" });
  return out;
}

/** Two to four verbatim things Sage observed on the way in: where it starts, and the first screen's own words. */
export function coreAnchors(map: Pick<ProductMapV1, "fieldTest">, corpus: string, startsAt: string | null): string[] {
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
export function buildCoreMission(hint: CoreHint, ctx: CoreContext): CandidateMission {
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
    priority: "high",
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
  map: Pick<ProductMapV1, "productName" | "fieldTest" | "observations">;
  productUrl: string;
  scope: ValidationScope;
  corpus: string;
  accepted: readonly CandidateMission[];
  modelHint: CoreHint | null;
}): CoreAdded | null {
  const { map, scope, corpus, accepted } = input;
  if (accepted.some((m) => m.missionKey === CORE_MISSION_KEY)) return null;
  const targetSurface = [...scope.knownUrls].find((u) => u === input.productUrl) ?? input.productUrl;
  const sources: SourceRef[] = scope.knownUrls.has(targetSurface)
    ? [{ kind: "page", ref: targetSurface, observation: "The first screen Sage opened, and where a first-time visitor starts." }]
    : [{ kind: "founder", ref: "goal", observation: "The builder asked for this product to be tried by people." }];
  for (const hint of coreHintLadder(input.modelHint, accepted, map, corpus)) {
    const mission = buildCoreMission(hint, { productName: map.productName, targetSurface, anchors: coreAnchors(map, corpus, hint.startsAt), sources });
    const reports = validatePlanMissions([...accepted, mission], scope, corpus, map.observations);
    const report = reports[reports.length - 1]!;
    if (report.ok) return { mission: { ...mission, verifiabilityClass: classifyVerifiability(mission) }, hint, report };
  }
  return null;
}
