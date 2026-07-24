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
export type SyntheticValueKind = "display_name" | "search" | "ai_probe";

export type ControllerAction =
  | { kind: "click_element"; elementId: string }
  | { kind: "click_coords"; xPct: number; yPct: number }
  | { kind: "press_key"; key: AllowedKey }
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
  /** the exact option values, when this is a <select>. */
  options?: string[];
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
  }
}

/**
 * PURE guard: may Sage type a synthetic value into this input? Rejects anything that looks like a
 * credential / payment / personal-data field, regardless of what the model proposes. field-test.ts also
 * re-checks live in the page, but this keeps the minted `typable` flag honest.
 */
const SENSITIVE =
  /pass(word)?|email|e-mail|phone|tel|mobile|card|cc-|cvv|cvc|ccv|iban|routing|acct|account\b|ssn|social|secret|token|api[_-]?key|seed|mnemonic|private[_-]?key|wallet|address|street|zip|postal|postcode|dob|birth|passport|licen[sc]e|tax/i;
const SENSITIVE_TYPES = new Set(["password", "email", "tel", "number"]);
export function isSensitiveField(el: {
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  autocomplete?: string;
  ariaLabel?: string;
}): boolean {
  if (el.type && SENSITIVE_TYPES.has(el.type.toLowerCase())) return true;
  const hay = [el.name, el.id, el.placeholder, el.autocomplete, el.ariaLabel]
    .filter(Boolean)
    .join(" ");
  return SENSITIVE.test(hay);
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

/** The forward-affordance priority of a label, or -1 if none (lower index = higher priority). */
export function affordanceRank(label: string): number {
  const n = normLabel(label);
  if (!n) return -1;
  for (let i = 0; i < FORWARD_AFFORDANCES.length; i++) {
    const phrase = FORWARD_AFFORDANCES[i];
    if (n === phrase || n.includes(phrase)) return i;
  }
  return -1;
}

/**
 * Pick the obvious forward affordance to click BEFORE calling the model: the highest-priority
 * clickable element whose (state, action) signature hasn't already been tried. Pure + deterministic —
 * general across products. Returns null when nothing obvious remains (→ hand off to the model).
 */
export function chooseForwardAffordance(
  elements: MintedElement[],
  stateDigest: string,
  tried: ReadonlySet<string>,
): ControllerAction | null {
  let best: { el: MintedElement; rank: number } | null = null;
  for (const el of elements) {
    if (el.tag === "input" || el.tag === "textarea" || el.tag === "select")
      continue; // not a forward click
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
function canonicalAction(a: ControllerAction): string {
  switch (a.kind) {
    case "click_element":
      return `click:${a.elementId}`;
    case "click_coords":
      return `coords:${Math.round(a.xPct)},${Math.round(a.yPct)}`;
    case "press_key":
      return `key:${a.key}`;
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
    case "click_coords":
      return wrap({
        kind: "click_coords",
        xPct: clampPct(a.xPct),
        yPct: clampPct(a.yPct),
      });
    case "press_key": {
      const key = String(a.key);
      return KEY_SET.has(key)
        ? wrap({ kind: "press_key", key: key as AllowedKey })
        : null;
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
              "stop",
            ],
          },
          elementId: { type: ["string", "null"] },
          xPct: { type: ["number", "null"] },
          yPct: { type: ["number", "null"] },
          key: { type: ["string", "null"], enum: [...ALLOWED_KEYS, null] },
          valueKind: {
            type: ["string", "null"],
            enum: ["display_name", "search", "ai_probe", null],
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
          "xPct",
          "yPct",
          "key",
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
  "Return exactly ONE next action that best advances the goal, using ONLY the provided element ids, the allowlisted keys, normalized 0-100 coordinates, or a synthetic value KIND (display_name, search, ai_probe).",
  "You may NOT author selectors, JavaScript, URLs, credentials, or free-text values. To fill a name field use type_text with valueKind display_name; to message an in-product AI/NPC character (only if the goal requires talking to one) use type_text with valueKind ai_probe.",
  "Prefer obvious forward controls (Start, Continue, Enter, Come in, Skip). For a canvas/visual world with few DOM elements, use click_coords, press_key (arrows/WASD/Space/Enter), or drag to move and interact.",
  "STOP with status blocked if you hit a login, signup, CAPTCHA, wallet signature, payment, purchase, file upload, publish, or a message to a real person — never attempt those. STOP with status completed once the goal is clearly achieved.",
  "Do not repeat an action that already produced no change.",
  'Reply with ONLY a JSON object, no prose, exactly: {"action":{"kind":"...", ...fields for that kind...},"expectedChange":"...","goalProgress":"not_started|advancing|reached|blocked"}.',
  'Field per kind: click_element→{"kind":"click_element","elementId":"e3"}; click_coords→{"kind":"click_coords","xPct":50,"yPct":80}; press_key→{"kind":"press_key","key":"Enter"}; type_text→{"kind":"type_text","elementId":"e1","valueKind":"display_name"}; select_option→{"kind":"select_option","elementId":"e2","optionValue":"US"}; scroll→{"kind":"scroll","direction":"down"}; drag→{"kind":"drag","fromXPct":40,"fromYPct":50,"toXPct":60,"toYPct":50}; wait→{"kind":"wait"}; go_back→{"kind":"go_back"}; stop→{"kind":"stop","status":"completed|blocked","reason":"..."}.',
].join(" ");

function controllerUserText(
  goal: string,
  view: ControllerStateView,
  history: ControllerHistoryItem[],
  remainingActions: number,
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
  return [
    `FOUNDER GOAL: ${goal}`,
    `CURRENT URL: ${view.url}`,
    `REMAINING ACTIONS: ${remainingActions}`,
    `VISIBLE TEXT (bounded):\n<<<UNTRUSTED_PAGE\n${view.visibleText.slice(0, 1200)}\n>>>`,
    `INTERACTIVE ELEMENTS (reference by id only):\n${els || "  (none — this is a canvas/visual state; use coords/keys)"}${canvas}`,
    `YOUR RECENT ACTIONS:\n${hist}`,
    `Return the single next action toward the goal.`,
  ].join("\n\n");
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
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
): Promise<ControllerDecision | null> {
  const complete = deps.complete
    ? deps.complete
    : (() => {
        const p = resolveController(deps);
        return p
          ? (sys: string, usr: string, img: string | null) =>
              callController(p, sys, usr, img)
          : null;
      })();
  if (!complete) return null;
  const user = controllerUserText(goal, view, history, remainingActions);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await complete(CONTROLLER_SYSTEM, user, imageDataUri);
    if (raw) {
      const decision = coerceDecision(isolateJson(raw), view.elements);
      if (decision) return decision;
    }
    deps.log?.(
      `[controller] decision attempt ${attempt + 1} unusable — ${attempt === 0 ? "retrying once" : "giving up"}`,
    );
  }
  return null;
}
