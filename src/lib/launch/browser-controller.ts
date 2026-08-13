import { createHash } from "node:crypto";

/**
 * Sage's goal-directed browser controller — the "eyes + intent" that turns the Field Test from a blind
 * affordance-clicker into a tester that actually PURSUES the founder's goal. It is deliberately split so
 * the DECISION is auditable and the BROWSER stays the single guarded Playwright surface in field-test.ts:
 *
 *   · The controller only ever proposes ONE bounded next action from a fixed contract. It may NOT author
 *     selectors, JavaScript, shell, URLs, credentials, or arbitrary form text — it picks a Sage-minted
 *     element id, an allowlisted key, normalized coordinates, or a SYNTHETIC value KIND (resolved to fixed
 *     text here, never model-authored). field-test.ts executes it inside the existing egress guard.
 *   · Deterministic affordances (Start / Continue / Enter / Come in / Skip …) are preferred BEFORE the
 *     model is ever called — cheap, general, and identical for any onboarding.
 *   · Loop prevention hashes (state, action) so an ineffective action is never repeated.
 *
 * Nothing here touches request identity, approval, payout, settlement, replay, budgeting, or migrations.
 */

/* ───────────────────────────── the action contract ───────────────────────── */

/** Keys the model may press — movement + confirm/dismiss only. NEVER arbitrary text (that is type_text). */
export const ALLOWED_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "w",
  "a",
  "s",
  "d",
] as const;
export type AllowedKey = (typeof ALLOWED_KEYS)[number];

/** Synthetic value KINDS — the model picks a kind; the exact text is resolved HERE, never by the model. */
export type SyntheticValueKind =
  | "display_name"
  | "search"
  | "ai_probe"
  | "url"
  | "quantity";

export type ControllerAction =
  | { kind: "click_element"; elementId: string }
  | { kind: "click_coords"; xPct: number; yPct: number }
  | { kind: "press_key"; key: AllowedKey; repeat?: number }
  | { kind: "type_text"; elementId: string; valueKind: SyntheticValueKind }
  | { kind: "select_option"; elementId: string; optionValue: string }
  | { kind: "scroll"; direction: "down" | "up" }
  | {
      kind: "drag";
      fromXPct: number;
      fromYPct: number;
      toXPct: number;
      toYPct: number;
    }
  | { kind: "wait" }
  | { kind: "go_back" }
  /** Go to another page of the SAME product. `path` must be one Sage already discovered and offered —
   *  the model picks from a list, it never composes a URL, so it can neither wander off-host nor
   *  invent a route. Without this the explorer is single-page: it was built for a product that lives
   *  on one screen, and on a normal app it clicks the hero button forever and never reaches the flow
   *  the founder asked about. */
  | { kind: "open_path"; path: string }
  | { kind: "stop"; status: "completed" | "blocked"; reason: string };

export type GoalProgress = "not_started" | "advancing" | "reached" | "blocked";

export interface ControllerDecision {
  action: ControllerAction;
  /** what the controller expects to observably change — recorded, then checked against the real delta. */
  expectedChange: string;
  goalProgress: GoalProgress;
}

/** One interactive element Sage minted for this state. The model references it ONLY by `id`. */
export interface MintedElement {
  id: string;
  label: string;
  role: string;
  tag: string;
  /** true only for a non-sensitive text input Sage may type a synthetic value into. */
  typable: boolean;
  /** what this field is ASKING FOR, decided from the field itself — never from the model. */
  valueKind?: SyntheticValueKind;
  /** the exact option values, when this is a <select>. */
  options?: string[];
  /** SAME-SITE destination (path+search) when the element is a link — Sage-read from the DOM, never
   *  model-authored. Lets a failed click on an SPA (re-render stripped the minted attribute, an
   *  overlay swallowed the hit) fall back to going where the link was going anyway. */
  href?: string;
}

/* ─────────────────── synthetic-value policy (fixed, never model text) ─────── */

/** The fixed, transparent probe for an in-product AI/NPC conversation (only when the goal requires it). */
export const AI_PROBE =
  "Hello — I'm testing this product interaction. Please reply with a short greeting.";

/**
 * Resolve a synthetic value KIND → the exact text Sage will type. Deterministic + non-sensitive by
 * construction: it can only ever be a display name, a neutral search term, or the transparent AI probe.
 * There is no path to a password, email, phone, address, wallet, secret, or payment value.
 */
export function resolveSyntheticValue(kind: SyntheticValueKind): string {
  switch (kind) {
    case "display_name":
      return "Sage Test";
    case "ai_probe":
      return AI_PROBE;
    case "search":
      return "test";
    case "url":
      // RFC 2606 reserves example.com precisely so it can be written down without ever resolving to
      // someone's real service. A product whose job is to accept a URL gets a URL that is valid,
      // obviously synthetic, and incapable of pointing Sage or the founder at a third party.
      return "https://example.com";
    case "quantity":
      // Deliberately small: if a quantity ever reaches something that spends, it should be the least
      // it can be. Sage still never fills a card, an account or an amount field (see isSensitiveField).
      return "1";
  }
}

/**
 * The honest, human-readable record of what Sage typed. It becomes a state trigger in the trace and
 * is read by testers and by the mission brain, so it must name the value that actually landed —
 * never a generic "typed something".
 */
export function typedTrigger(kind: SyntheticValueKind): string {
  switch (kind) {
    case "ai_probe":
      return "typed a test message";
    case "display_name":
      return 'entered the name "Sage Test"';
    case "search":
      return "typed a search term";
    case "url":
      return "entered the URL https://example.com";
    case "quantity":
      return "entered the amount 1";
  }
}

/**
 * Pick the value kind a field is ASKING FOR, from the field itself. Deterministic and closed: the
 * model never chooses the text Sage types, and it cannot choose the kind either — it only points at
 * a field. A URL box gets a URL, a quantity box gets a number, a message box gets the transparent
 * probe, a search box gets a search term, and everything else gets a display name.
 *
 * This is what lets Sage complete a FORM rather than only a chat. `completeConversation` was the one
 * typing path in the product, so anything that wasn't "send a message and wait for a reply" could
 * only ever be clicked at — Sage would reach a founder's signup or launch form and stall there.
 */
export function classifyFieldValue(el: {
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  label?: string;
  tag?: string;
}): SyntheticValueKind {
  const hay = normalizeFieldText([
    el.name,
    el.id,
    el.placeholder,
    el.ariaLabel,
    el.label,
  ]);
  const type = (el.type ?? "").toLowerCase();
  if (
    type === "url" ||
    /\burl\b|\blink\b|website|https?:\/\/|\bdomain\b|\bsite\b/.test(hay)
  )
    return "url";
  if (type === "search" || /search|filter|query|find\b|look up/.test(hay))
    return "search";
  if (isQuantityField({ type, name: el.name, id: el.id, placeholder: el.placeholder, ariaLabel: el.ariaLabel, label: el.label }))
    return "quantity";
  // A textarea, or anything that calls itself a message, is a place to say something.
  if (
    (el.tag ?? "").toLowerCase() === "textarea" ||
    /message|comment|prompt|chat|ask|describe|feedback|note|body|reply|say/.test(hay)
  )
    return "ai_probe";
  return "display_name";
}

/**
 * A BENIGN quantity — a budget, an amount of items, a count. `type="number"` is otherwise refused
 * outright (see SENSITIVE_TYPES) because a card or account number must never be typed, and that
 * blanket refusal is why Sage could not fill a plain budget box. So the exception is an allowlist,
 * not a loosening: the field must positively read as a quantity AND still pass the sensitive check,
 * which independently rejects card / cvv / account / routing / iban / ssn wording.
 */
export function isQuantityField(el: {
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  label?: string;
}): boolean {
  const hay = normalizeFieldText([
    el.name,
    el.id,
    el.placeholder,
    el.ariaLabel,
    el.label,
  ]);
  if (!hay) return false;
  if (
    !/\bbudget\b|\bamount\b|\bquantity\b|\bqty\b|\bcount\b|how many|number of|\bsize\b|\blimit\b|\btesters\b|\bseats\b|\bslots\b|\bunits\b/.test(
      hay,
    )
  )
    return false;
  return !SENSITIVE.test(hay);
}

/**
 * PURE guard: may Sage type a synthetic value into this input? Rejects anything that looks like a
 * credential / payment / personal-data field, regardless of what the model proposes. field-test.ts also
 * re-checks live in the page, but this keeps the minted `typable` flag honest.
 */
/**
 * Field identifiers are written as `account_number`, `cardNumber`, `api-key` — and a word boundary
 * does NOT exist between `account` and `_number`, because `_` is a word character. So `account\b`
 * silently failed to match `account_number`, the single most common spelling of the thing it exists
 * to catch. Splitting camelCase and separators into spaces FIRST makes every boundary in the pattern
 * below mean what it says, and stops a bare substring like `count` matching inside `account`.
 */
export function normalizeFieldText(parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const SENSITIVE =
  /pass(word)?|e-?mail|phone|\btel\b|mobile|card|\bcc\b|cvv|cvc|ccv|iban|routing|\bacct\b|\baccount\b|\bssn\b|social|secret|token|api ?key|seed|mnemonic|private ?key|wallet|address|street|\bzip\b|postal|postcode|\bdob\b|birth|passport|licen[sc]e|\btax\b|\bcode\b|\botp\b|one[- ]?time|\bpin\b|\bfa\b|\bmfa\b/i;
const SENSITIVE_TYPES = new Set(["password", "email", "tel", "number"]);
/**
 * A VERIFICATION-CODE BOX IS NOT A TEXT FIELD. Measured on ClawUp (job mzQGzfo_0J8s, caught by the
 * founder reading the screenshots): after the emailed code was rejected, the form-filler treated the
 * "Verification code (1 min)" input as an ordinary text box and typed the synthetic probe — "Sage
 * Test" — into it. Guessing at a security code is never useful, it burns the product's rate limits,
 * and on a screenshot it reads as the agent flailing. Only the OTP login flow may ever fill one, and
 * it does so with a code it actually read from the mailbox.
 */
export function isSensitiveField(el: {
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  autocomplete?: string;
  ariaLabel?: string;
  label?: string;
}): boolean {
  const hay = normalizeFieldText([
    el.name,
    el.id,
    el.placeholder,
    el.autocomplete,
    el.ariaLabel,
    el.label,
  ]);
  if (SENSITIVE.test(hay)) return true;
  if (el.type && SENSITIVE_TYPES.has(el.type.toLowerCase())) {
    // `type="number"` is blocked because a card or account number must never be typed — but that
    // blanket refusal also blocked every budget, quantity and count box, which is most of what a
    // form actually asks for. A field that positively reads as a quantity is allowed through; the
    // SENSITIVE check above has already refused card / cvv / account / routing / iban / ssn wording,
    // so this exception cannot reach a payment field. password / email / tel are never excepted.
    return !(el.type.toLowerCase() === "number" && isQuantityField(el));
  }
  return false;
}

/* ───────────────── deterministic forward-affordance preference ────────────── */

/**
 * General onboarding/progression affordances, most-specific first. These are NAVIGATION intents that
 * move a first-time user FORWARD through any product — not product-specific strings. "Come in" / "step
 * inside" / "tap to …" are common immersive-onboarding phrasings; "accept/agree" are deliberately absent
 * (consent is handled separately, privacy-first, and Sage never accepts terms as a real action).
 */
const FORWARD_AFFORDANCES: string[] = [
  "get started",
  "let's go",
  "lets go",
  "start now",
  "start",
  "begin",
  "get going",
  "step inside",
  "come in",
  "enter",
  "go inside",
  "dive in",
  "continue",
  "next",
  "proceed",
  "keep going",
  "onward",
  "play",
  "launch",
  "open",
  "join",
  "explore",
  "take a look",
  "look around",
  "tap to",
  "click to",
  "press to",
  "skip",
  "not now",
  "maybe later",
  "close",
  "dismiss",
  "done",
  "finish",
  "got it",
];

/** Normalize a label for affordance matching (lowercase, collapse whitespace, strip emoji/punct edges). */
function normLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The key a dead affordance is retired under.
 *
 * Retirement used to key on the element's exact minted label, so a page with several controls that
 * all read "Start" (a nav button, a hero CTA, the same word quoted in body copy, each minted with its
 * own role prefix) retired them ONE AT A TIME — sixteen clicks, one URL, no progress, and the action
 * budget gone before Sage reached the flow the founder asked about.
 *
 * What is actually dead is the WORD the tester would aim at, not the node. Strips a minted `role ·`
 * prefix and quoting so every control saying the same thing shares one verdict.
 */
export function affordanceKey(s: string): string {
  return normLabel(s)
    .replace(/^[a-z_-]+\s*·\s*/, "")
    .replace(/[“”"'`]/g, "")
    .trim();
}

/* ─────────────── goal-relative targeting (general, product-agnostic) ─────── */

/** Words that carry no targeting signal in a founder goal — everything else is a candidate target term. */
const GOAL_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "that",
  "this",
  "they",
  "them",
  "their",
  "there",
  "her",
  "his",
  "its",
  "our",
  "your",
  "you",
  "she",
  "him",
  "who",
  "was",
  "are",
  "can",
  "will",
  "would",
  "make",
  "makes",
  "made",
  "let",
  "lets",
  "want",
  "wants",
  "need",
  "needs",
  "should",
  "must",
  "able",
  "user",
  "users",
  "people",
  "person",
  "visitor",
  "visitors",
  "tester",
  "testers",
  "customer",
  "customers",
  "land",
  "lands",
  "landing",
  "goes",
  "get",
  "gets",
  "got",
  "see",
  "sees",
  "give",
  "gives",
  "take",
  "budget",
  "usd",
  "usdc",
  "dollar",
  "dollars",
  "reward",
  "rewards",
  "campaign",
  "mission",
  "missions",
  "product",
  "app",
  "site",
  "website",
  "page",
  "pages",
  "screen",
  "test",
  "testing",
  "tests",
  "try",
  "then",
  "after",
  "before",
  "when",
  "while",
  "where",
  "what",
  "how",
  "why",
  "any",
  "all",
  "one",
  "new",
  "first",
  "next",
  "last",
  "just",
  "also",
  "really",
  "very",
  "some",
  "more",
  "most",
  "each",
]);

/**
 * The founder goal's TARGET TERMS — the content words that name what Sage must reach or do (an entity,
 * a place, an interaction). Pure + product-agnostic: it's just "the meaningful words of the goal", used
 * to recognise a matching on-screen affordance. No product-specific strings anywhere.
 */
export function goalTerms(goal: string): string[] {
  const words = goal.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    const t = w.replace(/[''-]+$/, "");
    if (t.length < 3 || GOAL_STOPWORDS.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out.slice(0, 12);
}

/** Does the founder's goal require an actual conversation/message exchange? Pure, language-general. */
export function goalWantsConversation(goal: string): boolean {
  return /\b(talk|talks|talking|chat|chats|chatting|speak|speaks|message|messages|messaging|ask|asks|converse|conversation|dialogue|dialog|reply|replies|respond|responds|response|greet|greets|say|says)\b/i.test(
    goal,
  );
}

/** Does the founder's goal ask for SEARCHING/filtering? Only then is a search box part of the work —
 *  otherwise a site's global search field is navigation chrome, not a form to complete. Pure. */
export function goalWantsSearch(goal: string): boolean {
  return /\b(search|searches|searching|find|finds|filter|filters|filtering|look ?up|query|queries)\b/i.test(goal);
}

/**
 * A NAVIGATION MENU is where a product hides its map. On plenty of real sites (mobile-first
 * marketing pages, SPAs, docs) the nav links exist only after a burger/menu toggle is opened — the
 * explorer then sees a near-empty screen, harvests no paths, and stops to ask the founder a
 * question the menu button could have answered ("could only reach the entry screen", 28% of all
 * inspections). Deterministic, general, one click per screen: open the thing that names itself a
 * menu, then let the normal harvest/choosers read what it revealed.
 */
const MENU_LABELS = new Set([
  "menu",
  "open menu",
  "close menu",
  "main menu",
  "navigation",
  "open navigation",
  "nav",
  "toggle menu",
  "toggle navigation",
  "hamburger",
  "☰",
  "≡",
  "show menu",
  "site menu",
]);

export function chooseMenuAffordance(
  elements: MintedElement[],
  stateDigest: string,
  tried: ReadonlySet<string>,
  deadLabels: ReadonlySet<string> = new Set(),
): ControllerAction | null {
  for (const el of elements) {
    if (el.tag === "input" || el.tag === "textarea" || el.tag === "select") continue;
    const key = affordanceKey(el.label);
    if (!MENU_LABELS.has(key)) continue;
    if (deadLabels.has(key)) continue;
    const sig = actionSignature(stateDigest, { kind: "click_element", elementId: el.id });
    if (tried.has(sig)) continue;
    return { kind: "click_element", elementId: el.id };
  }
  return null;
}

/**
 * THE GOAL KNOWS WHERE TO GO — pick the discovered same-site PATH that most directly matches the
 * current checkpoint's terms ("playground" → /playground, or the path whose link label said
 * Playground). Links are the web's API: on a normal product the flow the founder named lives behind
 * one, and clicking around the entry screen instead of following it is how an explorer gets trapped
 * on a homepage (measured: commonstack.ai — goal named the playground, the header linked it, Sage
 * burned its budget searching and re-clicking the hero). Deterministic, product-agnostic; paths come
 * only from Sage's own DOM harvest, never from a model.
 */
export function chooseGoalPath(
  paths: ReadonlyArray<{ path: string; label: string }>,
  terms: readonly string[],
  visited: ReadonlySet<string>,
): string | null {
  if (terms.length === 0) return null;
  let best: { path: string; score: number } | null = null;
  for (const p of paths) {
    if (visited.has(p.path)) continue;
    const hay = `${p.label} ${p.path.replace(/[/\-_?=&]+/g, " ")}`;
    const score = goalMatchScore(hay, terms);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { path: p.path, score };
  }
  return best?.path ?? null;
}

/** How strongly an element label matches the goal's target terms (count of distinct matched terms). */
export function goalMatchScore(
  label: string,
  terms: readonly string[],
): number {
  const n = normLabel(label);
  if (!n) return 0;
  let score = 0;
  for (const t of terms) if (n.includes(t)) score++;
  return score;
}

/**
 * The CURRENT target Sage is pursuing: the next unmet journey checkpoint's entity + the context it must
 * happen in. Broad goal-wide matching is NOT the authority — a later checkpoint's entity is only pursued
 * once the earlier checkpoints are observed, so an entity named during onboarding can never pull Sage
 * "ahead" in the journey.
 */
export interface GoalTargetSpec {
  entity: string;
  context: string;
}

/** The terms that identify the CURRENT target: its entity, plus its required context as a fallback. */
export function targetTerms(target: GoalTargetSpec | null): string[] {
  if (!target) return [];
  const src = [target.entity, target.context].filter(Boolean).join(" ");
  return goalTerms(src);
}

/**
 * Pick the affordance that most directly advances the CURRENT checkpoint (its target entity), skipping
 * ones already tried or dead in this context. This is what lets Sage go to the thing it was asked to
 * reach instead of wandering — general to any visually located target, with no product-specific strings.
 * Returns null when nothing on screen matches the current target.
 */
export function chooseGoalTargetAffordance(
  elements: MintedElement[],
  terms: readonly string[],
  stateDigest: string,
  tried: ReadonlySet<string>,
  deadLabels: ReadonlySet<string> = new Set(),
): ControllerAction | null {
  if (terms.length === 0) return null;
  let best: { el: MintedElement; score: number } | null = null;
  for (const el of elements) {
    if (el.tag === "select") continue;
    if (deadLabels.has(affordanceKey(el.label))) continue;
    const score = goalMatchScore(el.label, terms);
    if (score <= 0) continue;
    const sig = actionSignature(stateDigest, {
      kind: "click_element",
      elementId: el.id,
    });
    if (tried.has(sig)) continue;
    if (!best || score > best.score) best = { el, score };
  }
  return best ? { kind: "click_element", elementId: best.el.id } : null;
}

/** A control's label is short; a sentence is prose. Prose that merely CONTAINS "continue" ("Please enter
 *  your name to continue", "By continuing you agree…") is not a forward control — only an exact phrase
 *  match qualifies past this length, so validation/consent copy can never be mistaken for a button. */
const CONTROL_LABEL_MAX = 24;

/** The forward-affordance priority of a label, or -1 if none (lower index = higher priority). */
export function affordanceRank(label: string): number {
  const n = normLabel(label);
  if (!n) return -1;
  for (let i = 0; i < FORWARD_AFFORDANCES.length; i++) {
    const phrase = FORWARD_AFFORDANCES[i];
    if (n === phrase) return i;
    if (n.includes(phrase) && n.length <= CONTROL_LABEL_MAX) return i;
  }
  return -1;
}

/** The stable, animation-proof word signature of a state's visible text — the set of real words (letters
 *  only, ≥2 chars), so drifting particles / emoji / spinners don't read as "progress". Pure. */
export function wordSignature(text: string): string {
  const words = (text.toLowerCase().match(/[a-zà-ÿ]{2,}/g) ?? []).slice(0, 400);
  return [...new Set(words)].sort().join(" ");
}

/**
 * Pick the obvious forward affordance to click BEFORE calling the model: the highest-priority
 * clickable element whose (state, action) signature hasn't already been tried AND whose label isn't
 * DEAD in the current context (an affordance that produced no real progress here — e.g. a "Continue"
 * that needs a choice first). `deadLabels` is cleared by the caller on real progress, so a temporarily
 * dead control becomes live again once the context changes. Pure + deterministic, general.
 */
export function chooseForwardAffordance(
  elements: MintedElement[],
  stateDigest: string,
  tried: ReadonlySet<string>,
  deadLabels: ReadonlySet<string> = new Set(),
): ControllerAction | null {
  let best: { el: MintedElement; rank: number } | null = null;
  for (const el of elements) {
    if (el.tag === "input" || el.tag === "textarea" || el.tag === "select")
      continue; // not a forward click
    if (deadLabels.has(affordanceKey(el.label))) continue; // ineffective here → try something else
    const rank = affordanceRank(el.label);
    if (rank < 0) continue;
    const sig = actionSignature(stateDigest, {
      kind: "click_element",
      elementId: el.id,
    });
    if (tried.has(sig)) continue;
    if (!best || rank < best.rank) best = { el, rank };
  }
  return best ? { kind: "click_element", elementId: best.el.id } : null;
}

/* ─────────────────────────── loop prevention ──────────────────────────────── */

/** A stable signature for (state, action) — repeating one that produced no change is a loop. Pure. */
export function actionSignature(
  stateDigest: string,
  action: ControllerAction,
): string {
  const canon = canonicalAction(action);
  return createHash("sha256")
    .update(`${stateDigest}|${canon}`)
    .digest("hex")
    .slice(0, 20);
}
export function canonicalAction(a: ControllerAction): string {
  switch (a.kind) {
    case "click_element":
      return `click:${a.elementId}`;
    case "open_path":
      return `open:${a.path}`;
    case "click_coords":
      return `coords:${Math.round(a.xPct)},${Math.round(a.yPct)}`;
    case "press_key":
      return `key:${a.key}`; // repeat is NOT in the signature — a burst of the same key is the same move
    case "type_text":
      return `type:${a.elementId}:${a.valueKind}`;
    case "select_option":
      return `select:${a.elementId}:${a.optionValue}`;
    case "scroll":
      return `scroll:${a.direction}`;
    case "drag":
      return `drag:${Math.round(a.fromXPct)},${Math.round(a.fromYPct)}->${Math.round(a.toXPct)},${Math.round(a.toYPct)}`;
    case "wait":
      return "wait";
    case "go_back":
      return "back";
    case "stop":
      return `stop:${a.status}`;
  }
}

/* ───────────── validate a raw model decision against the state (pure) ──────── */

const KEY_SET = new Set<string>(ALLOWED_KEYS);
const KIND_SET = new Set<SyntheticValueKind>([
  "display_name",
  "search",
  "ai_probe",
  // The controller prompt still only teaches the first three, so a model will rarely name these. They
  // are accepted rather than rejected because every kind resolves to a fixed, non-sensitive string —
  // and because the field's OWN classification (MintedElement.valueKind) overrides the model's choice
  // at execution time anyway. The model points at a field; the field decides what it is asking for.
  "url",
  "quantity",
]);
const clampPct = (n: unknown): number =>
  typeof n === "number" && isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;

/**
 * Coerce a raw model object into a valid, executable ControllerDecision — or null if it can't be made
 * safe. Every element reference must resolve to a minted id; every key must be allowlisted; every option
 * must be one the element actually presented; typing is only allowed into a `typable` (non-sensitive)
 * element. The model can never smuggle a selector, URL, key, or free-text value through here.
 */
export function coerceDecision(
  raw: unknown,
  elements: MintedElement[],
  /** the same-host paths Sage offered this turn — an `open_path` outside this list is refused. */
  offeredPaths: readonly string[] = [],
): ControllerDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const a = (r.action ?? r) as Record<string, unknown>;
  const kind = typeof a.kind === "string" ? a.kind : "";
  const byId = new Map(elements.map((e) => [e.id, e]));
  const progress: GoalProgress = [
    "not_started",
    "advancing",
    "reached",
    "blocked",
  ].includes(String(r.goalProgress))
    ? (r.goalProgress as GoalProgress)
    : "advancing";
  const expectedChange =
    typeof r.expectedChange === "string" ? r.expectedChange.slice(0, 200) : "";
  const wrap = (action: ControllerAction): ControllerDecision => ({
    action,
    expectedChange,
    goalProgress: progress,
  });

  switch (kind) {
    case "click_element": {
      const el = byId.get(String(a.elementId));
      return el ? wrap({ kind: "click_element", elementId: el.id }) : null;
    }
    case "open_path": {
      // only a path Sage itself discovered and offered — never a model-composed URL.
      const want = String(a.path ?? "").trim();
      return offeredPaths.includes(want) ? wrap({ kind: "open_path", path: want }) : null;
    }
    case "click_coords":
      return wrap({
        kind: "click_coords",
        xPct: clampPct(a.xPct),
        yPct: clampPct(a.yPct),
      });
    case "press_key": {
      const key = String(a.key);
      if (!KEY_SET.has(key)) return null;
      // a BOUNDED movement burst (1..5 presses) — enough to cross a walkable world without a free loop.
      const r =
        typeof a.repeat === "number" && isFinite(a.repeat)
          ? Math.round(a.repeat)
          : 1;
      const repeat = Math.max(1, Math.min(5, r));
      return wrap({ kind: "press_key", key: key as AllowedKey, repeat });
    }
    case "type_text": {
      const el = byId.get(String(a.elementId));
      const vk = String(a.valueKind) as SyntheticValueKind;
      if (!el || !el.typable || !KIND_SET.has(vk)) return null;
      return wrap({ kind: "type_text", elementId: el.id, valueKind: vk });
    }
    case "select_option": {
      const el = byId.get(String(a.elementId));
      const opt = String(a.optionValue);
      if (!el || !(el.options ?? []).includes(opt)) return null;
      return wrap({
        kind: "select_option",
        elementId: el.id,
        optionValue: opt,
      });
    }
    case "scroll":
      return wrap({
        kind: "scroll",
        direction: a.direction === "up" ? "up" : "down",
      });
    case "drag":
      return wrap({
        kind: "drag",
        fromXPct: clampPct(a.fromXPct),
        fromYPct: clampPct(a.fromYPct),
        toXPct: clampPct(a.toXPct),
        toYPct: clampPct(a.toYPct),
      });
    case "wait":
      return wrap({ kind: "wait" });
    case "go_back":
      return wrap({ kind: "go_back" });
    case "stop":
      return wrap({
        kind: "stop",
        status: a.status === "completed" ? "completed" : "blocked",
        reason: typeof a.reason === "string" ? a.reason.slice(0, 200) : "",
      });
    default:
      return null;
  }
}

/* ───────────────── provider-native strict json_schema (the action) ─────────── */

/** The strict transport schema the model must fill — all fields required + nullable (provider-native). */
export const BROWSER_ACTION_SCHEMA: {
  name: string;
  schema: Record<string, unknown>;
} = {
  name: "sage_browser_action_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: [
              "click_element",
              "click_coords",
              "press_key",
              "type_text",
              "select_option",
              "scroll",
              "drag",
              "wait",
              "go_back",
              "open_path",
              "stop",
            ],
          },
          elementId: { type: ["string", "null"] },
          path: { type: ["string", "null"] },
          xPct: { type: ["number", "null"] },
          yPct: { type: ["number", "null"] },
          key: { type: ["string", "null"], enum: [...ALLOWED_KEYS, null] },
          repeat: { type: ["integer", "null"] },
          valueKind: {
            type: ["string", "null"],
            enum: ["display_name", "search", "ai_probe", "url", "quantity", null],
          },
          optionValue: { type: ["string", "null"] },
          direction: { type: ["string", "null"], enum: ["up", "down", null] },
          fromXPct: { type: ["number", "null"] },
          fromYPct: { type: ["number", "null"] },
          toXPct: { type: ["number", "null"] },
          toYPct: { type: ["number", "null"] },
          status: {
            type: ["string", "null"],
            enum: ["completed", "blocked", null],
          },
          reason: { type: ["string", "null"] },
        },
        required: [
          "kind",
          "elementId",
          "path",
          "xPct",
          "yPct",
          "key",
          "repeat",
          "valueKind",
          "optionValue",
          "direction",
          "fromXPct",
          "fromYPct",
          "toXPct",
          "toYPct",
          "status",
          "reason",
        ],
      },
      expectedChange: { type: "string" },
      goalProgress: {
        type: "string",
        enum: ["not_started", "advancing", "reached", "blocked"],
      },
    },
    required: ["action", "expectedChange", "goalProgress"],
  },
};

/* ───────────────────────── the model action-decider ───────────────────────── */

export interface ControllerStateView {
  url: string;
  /** bounded visible text of the current state (never the raw DOM). */
  visibleText: string;
  elements: MintedElement[];
  /** canvas / frame geometry hints, when the product is visually driven. */
  canvas?: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
}
export interface ControllerHistoryItem {
  action: string;
  changed: boolean;
  note?: string;
}

export interface DecideDeps {
  /** test seam: replace the real multimodal network call. */
  complete?: (
    system: string,
    user: string,
    imageDataUri: string | null,
  ) => Promise<string | null>;
  model?: string;
  endpoint?: string;
  key?: string;
  log?: (m: string) => void;
}

const CONTROLLER_SYSTEM = [
  "You are Sage, an autonomous product tester driving a real web browser to accomplish ONE founder goal.",
  "You are given the goal, the current screen (screenshot + visible text), a list of Sage-minted interactive elements (referenced ONLY by their id), optional canvas geometry, and your recent actions with outcomes.",
  "Return exactly ONE next action that best advances the goal, using ONLY the provided element ids, the allowlisted keys, normalized 0-100 coordinates, one of the offered same-product paths (open_path), or a synthetic value KIND (display_name, search, ai_probe, url, quantity).",
  "You may NOT author selectors, JavaScript, URLs, credentials, or free-text values. To fill a name field use type_text with valueKind display_name; to message an in-product AI/NPC character (only if the goal requires talking to one) use type_text with valueKind ai_probe.",
  "Prefer obvious forward controls (Start, Continue, Enter, Come in, Skip). For a canvas/visual world with few DOM elements, use click_coords, press_key (arrows/WASD/Space/Enter), or drag to move and interact.",
  "PRIORITY once the product's main experience is reached: go to the thing the GOAL names. If a label or on-screen affordance matching the goal's target is visible, click that element (or its screen coordinates) directly. If the target is visible but out of reach, use press_key with a repeat of 2-5 as a bounded movement burst toward it, then reassess from the new screenshot; if a direction produces no goal-relative progress twice, try a different direction.",
  "STOP with status blocked if you hit a login, signup, CAPTCHA, wallet signature, payment, purchase, file upload, publish, or a message to a real person — never attempt those. STOP with status completed once the goal is clearly achieved.",
  "Do not repeat an action that already produced no change.",
  'Reply with ONLY a JSON object, no prose, exactly: {"action":{"kind":"...", ...fields for that kind...},"expectedChange":"...","goalProgress":"not_started|advancing|reached|blocked"}.',
  'Field per kind: click_element→{"kind":"click_element","elementId":"e3"}; click_coords→{"kind":"click_coords","xPct":50,"yPct":80}; press_key→{"kind":"press_key","key":"ArrowRight","repeat":3}; type_text→{"kind":"type_text","elementId":"e1","valueKind":"display_name"}; select_option→{"kind":"select_option","elementId":"e2","optionValue":"US"}; scroll→{"kind":"scroll","direction":"down"}; drag→{"kind":"drag","fromXPct":40,"fromYPct":50,"toXPct":60,"toYPct":50}; wait→{"kind":"wait"}; go_back→{"kind":"go_back"}; open_path→{"kind":"open_path","path":"/one-of-the-offered-paths"}; stop→{"kind":"stop","status":"completed|blocked","reason":"..."}.',
].join(" ");

function controllerUserText(
  goal: string,
  view: ControllerStateView,
  history: ControllerHistoryItem[],
  remainingActions: number,
  /** other pages of this same product Sage has discovered — the only paths `open_path` may use. */
  offeredPaths: readonly string[] = [],
): string {
  const els = view.elements
    .slice(0, 40)
    .map(
      (e) =>
        `  ${e.id}: <${e.tag}${e.role ? ` role=${e.role}` : ""}${e.typable ? " typable" : ""}> "${e.label.slice(0, 80)}"${e.options ? ` options=[${e.options.slice(0, 8).join(", ")}]` : ""}`,
    )
    .join("\n");
  const hist =
    history
      .slice(-8)
      .map(
        (h, i) =>
          `  ${i + 1}. ${h.action} → ${h.changed ? "changed" : "no change"}${h.note ? ` (${h.note})` : ""}`,
      )
      .join("\n") || "  (none yet)";
  const canvas = view.canvas
    ? `\nCANVAS (normalized %): x=${view.canvas.xPct} y=${view.canvas.yPct} w=${view.canvas.wPct} h=${view.canvas.hPct}`
    : "";
  // Which on-screen elements match the goal's target terms — the model should go THERE, not wander.
  const terms = goalTerms(goal);
  const targets = view.elements
    .filter((e) => goalMatchScore(e.label, terms) > 0)
    .slice(0, 6)
    .map((e) => `${e.id} "${e.label.slice(0, 60)}"`)
    .join(", ");
  return [
    `FOUNDER GOAL: ${goal}`,
    `GOAL TARGET TERMS: ${terms.join(", ") || "(none)"}`,
    targets
      ? `ELEMENTS MATCHING THE GOAL (prefer these): ${targets}`
      : `NO on-screen element matches the goal yet — move toward it or open what likely contains it.`,
    `CURRENT URL: ${view.url}`,
    `REMAINING ACTIONS: ${remainingActions}`,
    `VISIBLE TEXT (bounded):\n<<<UNTRUSTED_PAGE\n${view.visibleText.slice(0, 1200)}\n>>>`,
    `INTERACTIVE ELEMENTS (reference by id only):\n${els || "  (none — this is a canvas/visual state; use coords/keys)"}${canvas}`,
    offeredPaths.length > 0
      ? `OTHER PAGES OF THIS PRODUCT (open one with open_path when the goal clearly lives elsewhere — e.g. the flow the founder named is not on this screen):\n${offeredPaths.map((p) => `  ${p}`).join("\n")}`
      : "",
    `YOUR RECENT ACTIONS:\n${hist}`,
    `Return the single next action toward the goal.`,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

const DEFAULT_BASE = "https://api.commonstack.ai/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

function resolveController(
  deps: DecideDeps,
): { endpoint: string; key: string; model: string } | null {
  const key =
    deps.key ??
    (process.env.LLM_API_KEY?.trim() ||
      process.env.COMMONSTACK_API_KEY?.trim());
  if (!key) return null;
  const base = (
    deps.endpoint ??
    (process.env.LLM_BASE_URL?.trim() ||
      process.env.COMMONSTACK_BASE_URL?.trim() ||
      DEFAULT_BASE)
  ).replace(/\/+$/, "");
  const model =
    deps.model ??
    (process.env.VISION_MODEL?.trim() ||
      process.env.MISSION_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      process.env.DEPUTY_MODEL?.trim() ||
      DEFAULT_MODEL);
  return {
    endpoint:
      deps.endpoint && deps.endpoint.includes("/chat/completions")
        ? deps.endpoint
        : `${base}/chat/completions`,
    key,
    model,
  };
}

const CONTROLLER_TIMEOUT_MS = 30_000;

async function callController(
  provider: { endpoint: string; key: string; model: string },
  system: string,
  user: string,
  imageDataUri: string | null,
  log: (m: string) => void = () => {},
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTROLLER_TIMEOUT_MS);
  try {
    const userContent = imageDataUri
      ? [
          { type: "text", text: user },
          { type: "image_url", image_url: { url: imageDataUri } },
        ]
      : user;
    const res = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        max_tokens: 400,
        // json_object (NOT strict json_schema): the Flash-Lite provider ignores strict json_schema for
        // multimodal calls (returns a bare enum value, not the object). json_object forces valid JSON; the
        // exact SHAPE is enforced deterministically by coerceDecision, so the model can smuggle nothing.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      // SILENT nulls made "browsing fails on product X" undiagnosable — a 400 (model can't take an
      // image), a 401 (bad key) and a 429 (quota) all looked identical. Status + model are leak-safe.
      log(`[controller] provider ${res.status} (model=${provider.model}${imageDataUri ? ", multimodal" : ""})`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    log(`[controller] provider unreachable (${e instanceof Error ? e.name : "error"})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Leniently isolate a JSON object from a model reply — tolerate ```json fences / stray prose. */
export function isolateJson(raw: string): unknown {
  const s = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{"),
      b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Decide the next action from the current state via the multimodal model. ONE structured-output retry;
 * returns null (the caller falls back to a deterministic scroll/stop) on any failure. The returned
 * decision is already coerced/validated against the minted elements — safe to execute.
 */
export async function decideNextAction(
  goal: string,
  view: ControllerStateView,
  history: ControllerHistoryItem[],
  remainingActions: number,
  imageDataUri: string | null,
  deps: DecideDeps = {},
  /** other same-host pages Sage discovered; empty once the navigation budget is spent. */
  offeredPaths: readonly string[] = [],
): Promise<ControllerDecision | null> {
  const complete = deps.complete
    ? deps.complete
    : (() => {
        const p = resolveController(deps);
        return p
          ? (sys: string, usr: string, img: string | null) =>
              callController(p, sys, usr, img, deps.log ?? (() => {}))
          : null;
      })();
  if (!complete) return null;
  const user = controllerUserText(goal, view, history, remainingActions, offeredPaths);
  for (let attempt = 0; attempt < 2; attempt++) {
    // TEXT-ONLY FALLBACK on the retry: if the configured model can't take an image (a non-multimodal
    // model behind a gateway 400s the image_url part), the first attempt fails — the retry re-asks
    // from the text view alone, so exploration degrades to text-guided instead of ending outright.
    const img = attempt === 0 ? imageDataUri : null;
    const raw = await complete(CONTROLLER_SYSTEM, user, img);
    if (raw) {
      const decision = coerceDecision(isolateJson(raw), view.elements, offeredPaths);
      if (decision) return decision;
    }
    deps.log?.(
      `[controller] decision attempt ${attempt + 1} unusable — ${attempt === 0 ? "retrying once (text-only)" : "giving up"}`,
    );
  }
  return null;
}
