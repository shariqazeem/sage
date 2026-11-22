import { REACHED_REPORT, splitCoreAccount, type Reached } from "@/lib/core-test/shape";
import { cover, cutAtWord, firstSentence, matchSageProblem, MAX_FINDINGS, NO_WORDS, OTHER_NOTES, plainTitle, QUOTE_MAX, verbatim, type Finding, type FindingKind, type PaidAnswer } from "./core";

/**
 * THE PLAIN REPORT: grouping what people wrote with no model at all (the core, 22 Nov 2026).
 *
 * A builder pays to know what to fix, and most days there is no model to ask. So the same answers are
 * grouped here, in code, by three things that need no judgment:
 *
 *   1. THE RUNG a person stopped on (their own tap). Two people who stopped in different places are
 *      never put in one problem.
 *   2. THE WORDS they share. Each answer is read sentence by sentence; a sentence that reports a
 *      problem is reduced to the things it names ("connect", "wallet"). Two people are one problem
 *      when their sentences name the same two things and fail the same way. One shared thing is
 *      enough only when the way it failed is specific (not found, no response, asked for something
 *      first, confusing, slow) and identical, and there is a second reason to believe it: both people
 *      tapped the same rung, or one of the sentences names nothing but that thing.
 *   3. SAGE'S OWN NOTES. Two people whose sentences both match the same problem Sage recorded itself
 *      (`matchSageProblem`, two shared words) are that problem.
 *
 * NEVER MERGE TWO DIFFERENT PROBLEMS. Every rule above only ever refuses: when in doubt two people
 * stay two findings of one person each, which is true, where one finding of two would be a guess.
 *
 * Nothing is invented. A group's title is a member's own sentence, its quotes are exact substrings
 * of paid answers (`verbatim`), and its count is the distinct people in it. The only words written
 * here are labels for what is not a problem: a rung's name, "What people liked", "Other notes".
 *
 * Pure: no I/O, no model, no clock.
 */

export const LIKED_TITLE = "What people liked";
/** Quotes kept on one plain finding: the builder reads one or two, the rest are a tap away. */
export const PLAIN_QUOTES = 3;

export type FailureMode = "not-found" | "no-response" | "blocked" | "confusing" | "slow" | "wrong" | "failed";

/** What plain grouping may know beyond the words: taps and Sage's notes. All of it optional. */
export interface PlainContext {
  /** the rung each core answer's person tapped, by submission id */
  rungs?: ReadonlyMap<string, Reached>;
  /** Sage's own problems from its first look: the id, and its title plus the exact recorded text */
  sageProblems?: readonly { id: string; text: string }[];
}

/* ───────────────────────────────────────────────────────────── the words ── */

const PHRASES: readonly [RegExp, string][] = [
  [/\bsign(?:ed|ing|s)?[\s-]?up\b/g, "signup"],
  [/\bregist(?:er|ered|ering|ration)\b/g, "signup"],
  [/\b(?:sign|log)(?:ged|ed|ging|ing|s)?[\s-]?in\b/g, "login"],
  [/\bcheck(?:ed|ing|s)?[\s-]?out\b/g, "checkout"],
  [/\be[\s-]mail\b/g, "email"],
  [/\bdrop[\s-]down\b/g, "dropdown"],
];

/** Words that name no thing: grammar, the generic vocabulary of failing, and the device it happened on. */
const STOP_WORDS =
  "the and for but not you your was were are has have had did does can could would will its this that with from they them then than when what which who how why where there here been being also just very really quite much many more most some any all each every other another into onto over under about after before again once still even ever never always already yet too out off one two three first second next last new old got get gets getting make made makes making take took takes use used using try tried trying want wanted need needed like liked seem seemed feel felt think thought know knew say said tell told see saw seen look looked looking find found finding show showed shown shows work worked working works happen happened happens nothing something anything everything thing things stuff way ways time times bit lot kind sort able unable cannot couldn wasn didn doesn isn wouldn won don stuck broke broken break error errors fail failed fails failure crash crashed bug bugs issue issues problem problems trouble wrong confusing confused unclear clear hard difficult easy slow fast good great nice fine okay bad app site website web page pages screen screens button buttons click clicked clicking press pressed pressing tap tapped tapping product tool platform user users people person tester test testing tested sage browser phone mobile desktop laptop chrome safari firefox android iphone went going come came goes back down top bottom left right side because though although however while until since maybe actually basically simply literally pretty please thanks thank overall honestly should must might may shall let lets put keep kept gave give gives given lost end ended tell able sure idea hidden missing buried blank spinner spinning loading load loaded loads respond responded response reaction minute minutes hour hours moment long stopped stop quit don didn doesn won can couldn wouldn isn wasn aren weren hasn haven hadn ain nope yes yeah okay what's that's there's it's i'm i've i'd i'll not none either neither both few little less least same different such own only around during through between against without within along across behind beyond above below near far away their theirs our ours his her hers him she he we us me my mine am is be an at by in on of to or as if so no do up it".split(
    /\s+/,
  );

/** A light stem: plurals, -ing, -ed, -ion and a final e, so "connecting wallets" meets "connect wallet". */
export function stem(word: string): string {
  if (/^\d+$/.test(word)) return word;
  let s = word;
  if (s.length > 5 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && /(?:sses|shes|ches|xes|zes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1);
  let t = s;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 6 && t.endsWith("ion")) t = t.slice(0, -3);
  if (t !== s && /([bdgkmnprt])\1$/.test(t)) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

const STOP = new Set([...STOP_WORDS, ...STOP_WORDS.map(stem)]);

const normal = (text: string): string => text.toLowerCase().replace(/[’‘`]/g, "'");

/** The things a sentence names: stemmed words of three letters or more that are not in the stop list. */
export function topicWords(text: string): Set<string> {
  let t = normal(text);
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  const out = new Set<string>();
  for (const raw of t.match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []) {
    const w = raw.replace(/'.*$/, "");
    if (w.length < 3 || STOP.has(w) || STOP.has(raw)) continue;
    const s = stem(w);
    if (s.length >= 3 && !STOP.has(s)) out.add(s);
  }
  return out;
}

/* ─────────────────────────────────────────────── what a sentence is saying ── */

/** "No problems at all": a negative word that is praise. Removed before a sentence is read for trouble. */
const CLEAN_SOURCE =
  /\b(?:no|zero|without(?: any)?|not (?:a single|any)|(?:didn't|did not|don't|do not) (?:have|find|see|hit|notice|run into|encounter|get) any) (?:real |major |big |other )?(?:issues?|problems?|troubles?|errors?|bugs?|complaints?|hiccups?|glitch(?:es)?|difficult(?:y|ies))\b|\bnothing (?:wrong|broke|to complain|bad)\b|\b(?:couldn't|could not|can't|cannot) (?:be (?:easier|simpler|better|happier)|fault|complain)\b|\bnot bad\b/i;
const CLEAN_ALL = new RegExp(CLEAN_SOURCE.source, "gi");

const NEG = "(?:did|does|do|is|was|were|are|would|will|could|can|has|have|had)(?:n't|nt| not)\\b|\\bcannot\\b|\\bcan't\\b|\\bwon't\\b|\\bunable\\b";
const TROUBLE =
  "stuck|nothing (?:happen|chang)|\\bno (?:response|reaction|feedback|way|button|link|option|indication|idea|clue|sign of|confirmation)\\b|broke|errors?\\b|crash|fail|\\bbugs?\\b|bugg|glitch|froze|freez|\\bhangs?\\b|\\bhung\\b|spinn|blank|white screen|\\b404|\\b50\\d\\b|timed? ?out|confus|unclear|\\bnot (?:clear|obvious|sure|intuitive|working|responding|clickable|visible|able)\\b|hard to|difficult|\\bslow|forever|lagg|missing|hidden|buried|overlap|cut off|unreadable|\\btoo (?:small|many|long|much|slow)\\b|wrong|incorrect|mismatch|g[ai]ve up|\\bi (?:stopped|quit|left|bailed)\\b|stopped (?:there|here)|abandon|had to (?:refresh|reload|restart|guess)|kept (?:loading|spinning|asking|failing)|never (?:loaded|loads|arrived|got|came|finished|opened|worked|showed|appeared|received)|rejected|declined|invalid|frustrat|annoy|unresponsive|did nothing|does nothing";
/** a few plain failure phrases in Spanish, Portuguese, French and German: enough to see a problem as one */
const TROUBLE_ELSEWHERE =
  "\\bno (?:pude|puedo|funciona|funcion[oó]|encontr[eé]|encuentro|carga|carg[oó]|entiendo|entend[ií])|\\bn[aã]o (?:consegui|funciona|funcionou|encontrei|carrega|carregou|entendi)|n'ai pas (?:pu|trouv[eé]|compris)|\\bne (?:fonctionne|marche|charge) pas|funktioniert nicht|konnte (?:nicht|kein)|nicht (?:gefunden|geladen)|\\berro\\b|erreur|fehler|\\bfall[oó]";
const PROBLEM = new RegExp(`${NEG}|${TROUBLE}|${TROUBLE_ELSEWHERE}`, "i");
const BUG = /errors?\b|crash|exception|\b404|\b50\d\b|blank|white screen|glitch|\bbugs?\b|bugg|froze|freez|broke|invalid|\berro\b|erreur|fehler/i;
const IDEA =
  /\b(?:wish|would be (?:nice|great|good|helpful|better|cool)|should (?:add|have|be|show|let|allow|explain|say|include)|could (?:add|use|have|show)|please add|suggest|it would help|i'd (?:like|love|prefer)|would (?:like|love|prefer)|needs? (?:a|an|to|more|some)\b|add an?\b|consider|maybe (?:add|show)|feature request)/i;
const LIKED =
  /\b(?:love[ds]?|liked|enjoy(?:ed)?|great|nice|clean|easy|smooth|intuitive|good|awesome|cool|beautiful|polished|impress\w*|well (?:done|made|designed)|straightforward|simple|fast|quick|worked (?:fine|well|great|perfectly|first)|works (?:fine|well|great|perfectly))\b/i;

const NOT_FOUND =
  /(?:n't|\bnot|\bnever|\bunable to|\bhard to|\bdifficult to|\bimpossible to|\bno way to|\bstruggl\w* to|\btook .{0,24}to) (?:\w+ ){0,2}(?:find|locate|see|spot)\b|\bwhere (?:is|to|do|does|the|i)\b|look(?:ed|ing) (?:for|around)|search(?:ed|ing)? for|hidden|buried|\bno (?:\w+ )?(?:button|link|option|menu)\b|anywhere|nowhere|not visible|missing|no encontr|n[aã]o encontr|pas trouv|nicht gefunden/i;
const NO_RESPONSE =
  /nothing (?:happen|chang)|(?:n't|\bnot) (?:respond|react|do anything|go anywhere|change|open|load|start|submit|send|move)|\bno (?:response|reaction|feedback|confirmation|indication)\b|unresponsive|\bnot (?:working|responding|clickable)\b|stuck (?:on |at )?(?:the |a )?(?:load|spinn)|spinn|kept loading|still loading|loading forever|never (?:loaded|loads|finished|opened|arrived|came|appeared|showed)|froze|freez|\bhangs?\b|\bhung\b|just sat|did nothing|does nothing|no carg|n[aã]o carreg|ne charge pas|nicht geladen/i;
const CONFUSING =
  /confus|unclear|\bnot (?:clear|obvious|sure|intuitive)\b|(?:n't|\bnot) (?:know|understand|get what|tell what)|\bno (?:idea|clue)\b|hard to (?:understand|follow|tell|figure)|what to do|what (?:it|this) (?:is|does|means)|no entiend|n[aã]o entend|pas compris/i;
/** the product asked for something before the person had seen what they would get */
const BLOCKED =
  /\bask(?:s|ed|ing)? (?:me )?(?:for|to)\b|\bwant(?:s|ed)? (?:me to|a|an|my)\b|requir|\bforc(?:e|es|ed|ing)\b|\bneed(?:s|ed)? (?:me to|a|an|my)\b|\bhad to (?:connect|sign|log|create|install|pay|verify|give|enter)|\bbefore (?:showing|i could|letting|seeing|i can)|\b(?:don't|do not|didn't|did not) have (?:a|an|one|any)\b/i;
const SLOW = /\bslow|forever|took (?:too |so |very |a )?long|long time|lagg|\bwait(?:ed|ing)?\b/i;
const WRONG = /wrong|incorrect|mismatch|(?:n't|\bnot) match|different (?:from|than)|inaccurate/i;

/** The sentence with praise-by-negation taken out ("no issues at all"), ready to be read for trouble. */
const troubleText = (sentence: string): string => normal(sentence).replace(CLEAN_ALL, " ");

/** What a sentence is: a problem (stuck or broken), an idea, praise, or none of them. */
export function kindOfSentence(sentence: string): FindingKind {
  const t = troubleText(sentence);
  if (PROBLEM.test(t)) return BUG.test(t) ? "bug" : "stuck";
  const n = normal(sentence);
  if (IDEA.test(n)) return "idea";
  if (CLEAN_SOURCE.test(n) || LIKED.test(n)) return "liked";
  return "other";
}

/** HOW it went wrong, from the sentence's own words. "failed" is the general one: it did not work. */
export function failureMode(text: string): FailureMode {
  const t = troubleText(text);
  if (NOT_FOUND.test(t)) return "not-found";
  if (NO_RESPONSE.test(t)) return "no-response";
  if (BLOCKED.test(t)) return "blocked";
  if (CONFUSING.test(t)) return "confusing";
  if (SLOW.test(t)) return "slow";
  if (WRONG.test(t)) return "wrong";
  return "failed";
}

/** One shared thing is enough only for these: the thing plus the way it failed IS the problem. */
const SPECIFIC = new Set<FailureMode>(["not-found", "no-response", "blocked", "confusing", "slow"]);

/**
 * Two problem sentences fail the same way: the same mode. The general one ("it failed") says least,
 * so there the two must also be the same kind: "the upload crashed" is not "the upload was refused".
 */
function sameFailure(a: Pick<Unit, "mode" | "kind">, b: Pick<Unit, "mode" | "kind">): boolean {
  return a.mode === b.mode && (a.mode !== "failed" || a.kind === b.kind);
}

/* ──────────────────────────────────────────────────────────── the units ── */

/** One sentence of one paid answer, as exact words, with what it names and how it reads. */
export interface Unit {
  /** the submission it is from */
  id: string;
  /** an exact substring of that answer */
  text: string;
  words: Set<string>;
  kind: FindingKind;
  mode: FailureMode;
  /** the rung this person stopped on; null when they finished, or did not tap */
  stopped: Exclude<Reached, "finished"> | null;
  /** the problem in Sage's own first look this sentence matches, by two shared words */
  sage: string | null;
}

/** An answer's sentences, each an exact substring of it. A newline ends a sentence as a full stop does. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const push = (end: number) => {
    const s = cutAtWord(text.slice(start, end).trim(), QUOTE_MAX);
    if (s.length >= 3 && /\p{L}/u.test(s)) out.push(s);
    start = end;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "\n") push(i + 1);
    else if (/[.!?]/.test(c) && (i + 1 === text.length || /\s/.test(text[i + 1]!))) push(i + 1);
  }
  push(text.length);
  return out;
}

/**
 * The sentences of one answer that plain grouping reads. For the four-part core answer the first
 * impression is left out: it answers "what do you think this is", which the report counts separately,
 * and "I have no idea what this is" is not a thing that broke.
 */
function unitsOf(a: PaidAnswer, ctx: PlainContext): Unit[] {
  const tapped = ctx.rungs?.get(a.id);
  const parts = tapped ? splitCoreAccount(a.text) : null;
  const read = parts ? [parts.detail, parts.action, parts.verdict] : [a.text];
  const stopped = tapped && tapped !== "finished" ? tapped : null;
  return read.flatMap(sentencesOf).map((text) => {
    const kind = kindOfSentence(text);
    const problem = kind === "stuck" || kind === "bug";
    return {
      id: a.id,
      text,
      words: topicWords(text),
      kind,
      mode: failureMode(text),
      stopped,
      sage: problem && ctx.sageProblems?.length ? matchSageProblem({ title: "", quotes: [{ submissionId: a.id, text }] }, [...ctx.sageProblems]) : null,
    };
  });
}

/* ─────────────────────────────────────────────────────────── the groups ── */

interface Cluster {
  units: Unit[];
  /** the things EVERY member names */
  sig: Set<string>;
  sage: string | null;
}

const shared = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> => new Set([...a].filter((w) => b.has(w)));
const people = (units: readonly Unit[]): number => new Set(units.map((u) => u.id)).size;
/** Different stopped rungs never meet; a person who finished, or did not tap, may stand beside either. */
const rungsAgree = (a: Unit["stopped"], b: Unit["stopped"]): boolean => a === null || b === null || a === b;

/** A sentence that names more things than this is a story, and one shared thing in it proves little. */
const ONE_THING_MAX_WORDS = 4;

/**
 * One shared thing is one problem only with a second reason: the same specific failure, the same
 * place (both stopped on the same rung, or neither tapped), and then either that rung is a real one
 * or one of the two sentences names nothing else.
 */
function oneThing(a: Unit, b: Unit, narrow: boolean): boolean {
  if (!SPECIFIC.has(a.mode) || a.mode !== b.mode || a.stopped !== b.stopped) return false;
  if (a.words.size > ONE_THING_MAX_WORDS || b.words.size > ONE_THING_MAX_WORDS) return false;
  return a.stopped !== null || narrow || a.words.size === 1 || b.words.size === 1;
}

/** May `u` join this cluster? Returns the signature the cluster would then have. */
function joins(c: Cluster, u: Unit, problem: boolean): Set<string> | null {
  const sig = shared(c.sig, u.words);
  if (!c.units.every((m) => rungsAgree(m.stopped, u.stopped))) return null;
  if (sig.size >= 2) return !problem || c.units.every((m) => sameFailure(m, u)) ? sig : null;
  // one shared thing: only when that one thing is all the cluster stands on
  if (!problem || sig.size !== 1 || c.sig.size !== 1) return null;
  const narrow = c.units.some((m) => m.words.size === 1);
  return c.units.every((m) => oneThing(m, u, narrow)) ? sig : null;
}

/** Can two sentences begin a cluster? Two shared things; or one, by `oneThing`. */
function seed(a: Unit, b: Unit, problem: boolean): Cluster | null {
  if (a.id === b.id || !rungsAgree(a.stopped, b.stopped)) return null;
  const sig = shared(a.words, b.words);
  if (sig.size >= 2) return !problem || sameFailure(a, b) ? { units: [a, b], sig, sage: null } : null;
  if (!problem || sig.size !== 1) return null;
  return oneThing(a, b, false) ? { units: [a, b], sig, sage: null } : null;
}

/**
 * Group sentences by the things they share. Repeatedly takes the group with the most people (then the
 * longer signature, then the earliest), so the order of answers never changes which groups exist for
 * the same set of answers more than a tie would.
 */
function clusterByWords(pool: readonly Unit[], problem: boolean): Cluster[] {
  const out: Cluster[] = [];
  let left = [...pool];
  for (;;) {
    let best: Cluster | null = null;
    const tried = new Set<string>();
    for (let i = 0; i < left.length; i += 1) {
      for (let j = i + 1; j < left.length; j += 1) {
        const c = seed(left[i]!, left[j]!, problem);
        if (!c) continue;
        const key = `${[...c.sig].sort().join(" ")}|${left[i]!.mode}|${left[i]!.kind}|${left[i]!.stopped ?? ""}|${left[j]!.stopped ?? ""}`;
        if (tried.has(key)) continue;
        tried.add(key);
        for (const u of left) {
          if (c.units.includes(u)) continue;
          const sig = joins(c, u, problem);
          if (sig) {
            c.units.push(u);
            c.sig = sig;
          }
        }
        if (!best || people(c.units) > people(best.units) || (people(c.units) === people(best.units) && c.sig.size > best.sig.size)) best = c;
      }
    }
    if (!best || people(best.units) < 2) return out;
    out.push(best);
    const taken = new Set(best.units);
    left = left.filter((u) => !taken.has(u));
  }
}

/** Sentences that match the SAME problem in Sage's own notes are that problem, one group per rung. */
function clusterBySage(pool: readonly Unit[]): Cluster[] {
  const out: Cluster[] = [];
  const ids = [...new Set(pool.flatMap((u) => (u.sage ? [u.sage] : [])))];
  for (const sage of ids) {
    const units = pool.filter((u) => u.sage === sage);
    const rungs = [...new Set(units.flatMap((u) => (u.stopped ? [u.stopped] : [])))];
    // people who finished or did not tap stand with the one rung there is; with two rungs they stay out
    const parts = rungs.length <= 1 ? [units] : rungs.map((r) => units.filter((u) => u.stopped === r));
    for (const part of parts) if (people(part) >= 2) out.push({ units: part, sig: new Set(), sage });
  }
  return out;
}

/* ────────────────────────────────────────────────────── words on a finding ── */

const LEAD = /^(?:and|but|so|then|also|however|well|ok|okay|honestly|basically|first|second|next|finally|after that|at first)[,\s]+/i;

/**
 * A title from a person's own sentence. A long sentence is cut to the clause that says it: the first
 * clause that names the group's things and (for a problem) reports the trouble. The words are theirs;
 * only the capital letter at the front is ours.
 */
function titleFrom(sentence: string, sig: ReadonlySet<string>, problem: boolean): string {
  const clauses = sentence.split(/[,;:—–]|\s-\s|[.!?]+$/).map((c) => c.trim().replace(LEAD, "")).filter((c) => c.length >= 12);
  // a clause has to name something to stand as a title: "which is wrong" names nothing
  const names = (c: string) => topicWords(c).size > 0 && [...sig].every((w) => topicWords(c).has(w));
  const trouble = (c: string) => !problem || PROBLEM.test(troubleText(c));
  const use = clauses.find((c) => names(c) && trouble(c)) ?? (sig.size > 0 ? clauses.find(names) : undefined) ?? sentence.replace(LEAD, "");
  const title = plainTitle(use).replace(/[.!?]+$/, "");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const quote = (u: Unit, byId: ReadonlyMap<string, PaidAnswer>): { submissionId: string; text: string }[] => {
  const text = verbatim(u.text, byId.get(u.id)?.text ?? "");
  return text ? [{ submissionId: u.id, text }] : [];
};

function findingOf(c: Cluster, byId: ReadonlyMap<string, PaidAnswer>, order: ReadonlyMap<string, number>): Finding {
  // one sentence per person: the one that names the most of the group's things, then the shortest
  const per = new Map<string, Unit>();
  for (const u of c.units) {
    const had = per.get(u.id);
    const score = (x: Unit) => shared(x.words, c.sig).size * 1000 - x.text.length;
    if (!had || score(u) > score(had)) per.set(u.id, u);
  }
  const members = [...per.values()].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  // the title is the shortest sentence that reads whole in sixty characters, else the shortest
  const titled = [...members].sort((a, b) => Number(a.text.length > 64) - Number(b.text.length > 64) || a.text.length - b.text.length)[0]!;
  const bugs = members.filter((u) => u.kind === "bug").length;
  const kind: FindingKind = members[0]!.kind === "idea" ? "idea" : bugs * 2 > members.length ? "bug" : "stuck";
  const title = titleFrom(titled.text, c.sig, kind !== "idea") || OTHER_NOTES;
  // the titled person's words are already the title, so the others are read first
  const quoted = [...members.filter((u) => u !== titled), titled].slice(0, PLAIN_QUOTES).flatMap((u) => quote(u, byId));
  return { title, kind, submissionIds: members.map((u) => u.id), quotes: quoted, ...(c.sage ? { sageSaw: c.sage } : {}) };
}

/**
 * The paid answers as findings, with no model. Groups of people first, then each remaining problem
 * in its own person's words, then the people who stopped on a rung and named no problem, ideas, what
 * people liked, and last whatever is left.
 */
export function plainFindings(answers: readonly PaidAnswer[], ctx: PlainContext = {}): Finding[] {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const order = new Map(answers.map((a, i) => [a.id, i]));
  const units = answers.flatMap((a) => unitsOf(a, ctx));
  const problems = units.filter((u) => (u.kind === "stuck" || u.kind === "bug") && u.words.size > 0);

  const bySage = clusterBySage(problems);
  const inSage = new Set(bySage.flatMap((c) => c.units));
  const byWords = clusterByWords(problems.filter((u) => !inSage.has(u)), true);
  const groups = [...bySage, ...byWords].sort((a, b) => people(b.units) - people(a.units));
  const findings: Finding[] = groups.map((c) => findingOf(c, byId, order));

  // a problem only one person named: its own finding, in their words. A person already in a group
  // adds one only when the sentence is about something else entirely.
  const grouped = new Set(groups.flatMap((c) => c.units));
  const sigOf = new Map<string, Set<string>>();
  for (const c of groups) for (const u of c.units) sigOf.set(u.id, new Set([...(sigOf.get(u.id) ?? []), ...c.sig, ...u.words]));
  const named = new Set<string>();
  for (const u of units) {
    if (grouped.has(u) || (u.kind !== "stuck" && u.kind !== "bug") || named.has(u.id)) continue;
    const mine = sigOf.get(u.id);
    if (mine && (u.words.size < 2 || shared(u.words, mine).size > 0)) continue;
    named.add(u.id);
    findings.push({ title: titleFrom(u.text, new Set(), true) || OTHER_NOTES, kind: u.kind, submissionIds: [u.id], quotes: quote(u, byId) });
  }

  // people who stopped on a rung and wrote no problem of their own: the rung they tapped is the finding
  const held = () => new Set(findings.flatMap((f) => f.submissionIds));
  const soFar = held();
  for (const rung of ["first-screen", "found-start", "started"] as const) {
    const here = answers.filter((a) => ctx.rungs?.get(a.id) === rung && !soFar.has(a.id));
    if (here.length === 0) continue;
    const quotes = here.slice(0, PLAIN_QUOTES).flatMap((a) => {
      const q = firstSentence(splitCoreAccount(a.text)?.action ?? a.text);
      return q ? [{ submissionId: a.id, text: q }] : [];
    });
    findings.push({ title: REACHED_REPORT[rung], kind: "stuck", submissionIds: here.map((a) => a.id), quotes, rung });
  }

  // ideas: the same idea from two people is one finding; the rest stand alone, one per person
  const ideas = units.filter((u) => u.kind === "idea" && u.words.size > 0);
  const ideaGroups = clusterByWords(ideas, false);
  for (const c of ideaGroups) findings.push(findingOf(c, byId, order));
  const inIdea = new Set(ideaGroups.flatMap((c) => c.units));
  const ideaFrom = new Set(ideaGroups.flatMap((c) => c.units.map((u) => u.id)));
  for (const u of ideas) {
    if (inIdea.has(u) || ideaFrom.has(u.id)) continue;
    ideaFrom.add(u.id);
    findings.push({ title: titleFrom(u.text, new Set(), false) || OTHER_NOTES, kind: "idea", submissionIds: [u.id], quotes: quote(u, byId) });
  }

  // praise is not a problem to keep apart: everyone who reported nothing else and liked something
  const before = held();
  const liked = new Map<string, Unit>();
  for (const u of units) if (u.kind === "liked" && !before.has(u.id) && !liked.has(u.id)) liked.set(u.id, u);
  if (liked.size > 0) {
    const us = [...liked.values()];
    findings.push({ title: LIKED_TITLE, kind: "liked", submissionIds: us.map((u) => u.id), quotes: us.slice(0, PLAIN_QUOTES).flatMap((u) => quote(u, byId)) });
  }

  // an answer with no words at all says so, rather than hiding among the notes
  const silent = answers.filter((a) => !/[\p{L}\p{N}]/u.test(a.text));
  if (silent.length > 0) findings.push({ title: NO_WORDS, kind: "other", submissionIds: silent.map((a) => a.id), quotes: [] });

  // whoever is left said nothing code can sort. For the four-part answer the part worth reading is
  // what happened when they tried, not their first impression (the report shows that elsewhere).
  const sorted = held();
  const rest = answers.filter((a) => !sorted.has(a.id));
  if (rest.length > 0) {
    const quotes = rest.flatMap((a) => {
      const q = firstSentence((ctx.rungs?.has(a.id) ? splitCoreAccount(a.text)?.action : undefined) ?? a.text);
      return q ? [{ submissionId: a.id, text: q }] : [];
    });
    findings.push({ title: OTHER_NOTES, kind: "other", submissionIds: rest.map((a) => a.id), quotes });
  }

  // a long test keeps its biggest findings; whoever is left over is still in the report, under "Other notes"
  const kept = findings.length > MAX_FINDINGS ? [...findings].sort((a, b) => b.submissionIds.length - a.submissionIds.length).slice(0, MAX_FINDINGS) : findings;
  return cover(kept, answers);
}

/**
 * Every paid answer appears in at least one finding. Answers no finding holds are grouped plainly
 * among themselves (never into an existing finding: a model's group is not widened by code), and what
 * is left of those goes to "Other notes".
 */
export function coverPlainly(findings: readonly Finding[], answers: readonly PaidAnswer[], ctx: PlainContext = {}): Finding[] {
  const held = new Set(findings.flatMap((f) => f.submissionIds));
  const left = answers.filter((a) => !held.has(a.id));
  if (left.length === 0) return [...findings];
  const own = plainFindings(left, ctx).filter((f) => !(f.title === OTHER_NOTES && f.kind === "other"));
  return cover([...findings, ...own], answers);
}

/* ────────────────────────────────────────── the same problem, somewhere else ── */

/**
 * What a finding is about, as the things its people named: the words all of its quoted sentences
 * share, or (one quote, or nothing shared) every thing the title and quotes name. Used to ask whether
 * another set of answers ran into the same problem.
 */
export function signatureOf(finding: Pick<Finding, "title" | "quotes">): { words: Set<string>; mode: FailureMode } {
  // one sentence per quote is what the plain report stores; a model's quote may be a phrase, which reads the same
  const each = finding.quotes.map((q) => topicWords(q.text)).filter((set) => set.size > 0);
  const mode = failureMode(`${finding.title} ${finding.quotes.map((q) => q.text).join(" ")}`);
  const all = new Set([...topicWords(finding.title), ...each.flatMap((set) => [...set])]);
  if (each.length < 2) return { words: all, mode };
  // what every quoted sentence names; failing that, what at least two of them do
  const every = each.reduce((acc, set) => shared(acc, set));
  if (every.size > 0) return { words: every, mode };
  const seen = new Map<string, number>();
  for (const set of each) for (const w of set) seen.set(w, (seen.get(w) ?? 0) + 1);
  const some = new Set([...seen].filter(([, n]) => n >= 2).map(([w]) => w));
  return { words: some.size > 0 ? some : all, mode };
}

/**
 * The answers (by id) that ran into the problem a signature describes: a problem sentence that names
 * two of its things and fails the same way. A signature of one thing needs that thing and the same
 * specific failure. Praise that names the same things ("connecting my wallet was easy") is not a hit.
 */
export function hitBy(sig: { words: ReadonlySet<string>; mode: FailureMode }, answers: readonly PaidAnswer[], ctx: PlainContext = {}): string[] {
  if (sig.words.size === 0) return [];
  const out = new Set<string>();
  for (const a of answers) {
    for (const u of unitsOf(a, ctx)) {
      if (u.kind !== "stuck" && u.kind !== "bug") continue;
      const n = shared(u.words, sig.words).size;
      if (sig.words.size >= 2 ? n >= 2 && u.mode === sig.mode : n === 1 && SPECIFIC.has(sig.mode) && u.mode === sig.mode) out.add(a.id);
    }
  }
  return [...out];
}
