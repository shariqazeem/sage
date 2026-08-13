import "server-only";

/**
 * The "Field Test": Sage actually USES the inspected product in a real headless browser,
 * instead of only reading server-rendered HTML. It reuses the frozen SSRF/public-host guards
 * (validateEvidenceUrl + resolvesPublic) on the entry URL AND on every intercepted request,
 * then EITHER crawls a few ranked same-origin pages (a content site) OR — for a client-rendered
 * interactive app / game — runs a small STATE MACHINE: it waits out loading screens, safely
 * clicks start/continue controls, nudges a focused canvas with a few keys, and logs each real
 * observed state. It NEVER fills or submits a form, never types data, never authenticates, and
 * stays same-origin. Playwright is imported lazily so this module has no cost (and no dependency)
 * unless the flag is on. Everything is failure-isolated: any error degrades to an honest
 * limitation — the inspection job must never fail because exploration failed.
 *
 * Enabled ONLY when FIELD_TEST_ENABLED=1; otherwise the pipeline behaves exactly as before.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import type { BrowserContext, Page, Route } from "playwright";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";
import { resolvesPublic, sameSiteHost, BROWSER_UA } from "./inspect";
import { startEgressProxy } from "@/lib/net/egress-proxy";
import { describeStatesWithVision } from "./vision";
import { recordFieldTestStep } from "./field-test-progress";
import { planLoginForm, planOtpForm, loginSucceeded, redactSecrets, redactFieldTestDeep } from "./authenticated-exploration";
import { fetchOtpCode, type MailboxAccess } from "./otp-mailbox";
import { stateDigest } from "./observed-facts";
import {
  evaluateJourney,
  nextUnmetCheckpoint,
  buildJourneySteps,
  type GoalJourneyV1,
  goalRequiresUse,
} from "./goal-journey";
import {
  chooseForwardAffordance,
  chooseGoalTargetAffordance,
  chooseGoalPath,
  chooseMenuAffordance,
  targetTerms,
  goalTerms,
  goalWantsConversation,
  goalWantsSearch,
  goalMatchScore,
  decideNextAction,
  actionSignature,
  wordSignature,
  resolveSyntheticValue,
  isSensitiveField,
  classifyFieldValue,
  typedTrigger,
  type ControllerAction,
  type ControllerDecision,
  type ControllerHistoryItem,
  type MintedElement,
  type DecideDeps,
  affordanceKey,
} from "./browser-controller";
import type {
  DocPage,
  FieldTestForm,
  FieldTestPage,
  FieldTestState,
  FieldTestSummary,
  ProductMode,
  Truncation,
} from "./schemas";

/** Raw per-page capture, before summarization (internal). */
export interface FieldTestCapture {
  url: string;
  title: string;
  h1: string;
  ctas: string[];
  forms: FieldTestForm[];
  consoleErrors: string[];
  failedRequests: { url: string; status: number }[];
  rawHtmlTextLen: number;
  renderedTextLen: number;
  screenshot: string | null;
  /** rendered visible-text excerpt (bounded) — a static crawl's OBSERVATIONS (see FieldTestPage). */
  visibleTextExcerpt?: string;
}

const MAX_PAGES = 6;
const TOTAL_MS = 90_000;
const PAGE_MS = 15_000;
const MAX_CTAS = 10;

// interactive-explore budgets (spec caps). P21 raised the interaction + affordance ceilings so deep,
// tool-conditional UI (a drawing app's properties panel, an emoji world's many scenes) is actually
// REACHED — corpus completeness is the ceiling on autonomous verification, so Sage must out-explore the
// tester, not the reverse. The time cap is unchanged (still 3 min hard); the extra actions fit inside it.
const MAX_INTERACTIONS = 30; // goal-directed action budget (spec cap: 30 browser actions)
const MAX_STATES = 25; // retained meaningful states (spec cap)
/** Changes Sage will accept from ONE url before treating that screen as seen and looking for a way
 *  off it. A page whose own demo widget repaints on every click is otherwise indistinguishable from
 *  progress, and will happily absorb the entire exploration budget. */
const SCREEN_CHURN_CAP = 4;
/** States Sage will spend on the ENTRY screen before going looking for the product itself. Generous
 *  enough to cross a real onboarding ladder, small enough that a marketing page cannot eat the run. */
const ENTRY_STATE_CAP = 6;
const MAX_MODEL_CALLS = 12; // multimodal controller decisions (spec cap)
// Linear onboarding must not eat the exploration budget. Once the product's MAIN EXPERIENCE is reached,
// reserve a floor for real exploration, and allow a bounded extension while the controller is making
// verified goal progress (never an open-ended loop — the 3-minute wall clock still applies).
const RESERVE_ACTIONS = 8; // actions guaranteed AFTER the main experience is reached
const RESERVE_STATES = 5; // meaningful states guaranteed after that point
const RESERVE_MODEL_CALLS = 3; // multimodal decisions guaranteed after that point
/**
 * EVERYTHING THE MISSION BRAIN IS ALLOWED TO SEE, in one place.
 *
 * Each of these silently drops product content, and a cap nobody can see is invisible until a founder
 * finds the gap: a 900-char fold cap kept ClawUp's pricing out of every corpus for weeks, and nothing
 * in any artifact said so. So these constants are the single source of truth for BOTH the view builder
 * and {@link viewTruncations}, which reports what each one actually cost on this product. Change a
 * number here and the report follows by construction — the two cannot drift apart.
 */
const BRAIN_VIEW_CAPS = {
  states: MAX_INTERACTIONS + 4,
  stateTextChars: 800,
  notableElementsPerState: 10,
  // 6, not 4, and this is a correction rather than a new bet: the pageView comment below already
  // reasons "worst case 6 pages × 2000 ≈ 3k tokens of prompt, well inside the models' context and
  // the battery's cost cap", so the budget was set for 6 while the slice said 4. The starvation
  // report is what exposed the mismatch — every static product in the nonce-52 battery lost 1-2
  // whole crawled pages, meaning the crawl really does produce 5-6. A url-verifiable mission needs
  // page TEXT to cite, so pages the brain never receives are the most likely cause of the
  // long-standing drift to observation-only plans. Changed ALONE, so the battery reads one variable.
  pages: 6,
  pageTextChars: 2000,
  ctasPerPage: 8,
} as const;

const EXT_MAX_INTERACTIONS = 40; // hard extension ceiling (actions)
const EXT_MAX_STATES = 32; // hard extension ceiling (meaningful states)
const EXT_MAX_MODEL_CALLS = 16; // hard extension ceiling (model decisions)
const EXPLORE_MS = 180_000; // 3 minutes hard cap
const LOADING_BUDGET_MS = 60_000;
const LOADING_POLL_MS = 2_000;
const STABLE_DELTA = 4; // % — under this vs the prior poll counts as "settled"
/** Pages the explorer may open per run. Crossing into the founder's flow needs one or two; more
 *  than this is browsing the site instead of using it. */
const MAX_NAVIGATIONS = 3;
const CANVAS_MIN_AREA = 40_000; // ≥ ~200×200: a real surface, not an icon
const ANIMATION_PROBE_MS = 8_000; // watch a thin shell this long for self-animation (early-out on first change)
const MAX_AFFORDANCES = 10; // distinct scene/controls to click in a choice-driven experience (P21: 6→10)

// P21 canvas DRAWING — the excalidraw gap: exploration clicked toolbar icons but never DREW, so it never
// reached the states a real tester describes (a shape on the canvas + the properties panel that only
// appears once something is selected). A few safe drag strokes inside the canvas produce those states.
const DRAW_STROKES = 3; // safe drag gestures to make on a drawing surface
// tool words that put a canvas app into a "create a shape" mode (excalidraw, tldraw, whiteboards). "text"
// is DELIBERATELY excluded — selecting a text tool + clicking can focus a text input, and we never type.
const CREATION_TOOL_WORDS = [
  "rectangle",
  "ellipse",
  "circle",
  "diamond",
  "arrow",
  "line",
  "draw",
  "pencil",
  "pen",
  "brush",
  "shape",
  "freehand",
];

/* ───────────────────────────────── pure, unit-testable helpers ───────────── */

/** Whether the Field Test is enabled. Read directly (like other runtime feature flags). */
export function fieldTestEnabled(): boolean {
  return process.env.FIELD_TEST_ENABLED === "1";
}

/**
 * The interception guard: allow only http(s) schemes AND urls the frozen SSRF validator
 * accepts (which further requires https + a public, non-loopback host). A non-http(s)
 * scheme (data:, file:, blob:, ws:) or a private/loopback host is blocked.
 */
export function requestGuard(rawUrl: string): {
  allow: boolean;
  reason: string;
} {
  let protocol: string;
  try {
    protocol = new URL(rawUrl).protocol.toLowerCase();
  } catch {
    return { allow: false, reason: "unparseable url" };
  }
  if (protocol !== "http:" && protocol !== "https:")
    return { allow: false, reason: `blocked scheme ${protocol}` };
  const v = validateEvidenceUrl(rawUrl);
  if (!v.ok) return { allow: false, reason: v.error };
  return { allow: true, reason: "ok" };
}

/** Non-whitespace visible-text length of raw HTML (script/style + tags removed). Pure. */
export function visibleTextLen(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** JS-only heuristic: the rendered page carries substantially more text than the raw server HTML. */
export function computeJsOnly(
  rawHtmlTextLen: number,
  renderedTextLen: number,
): boolean {
  return renderedTextLen >= 400 && renderedTextLen > rawHtmlTextLen * 2 + 300;
}

/** The signals gathered on entry to decide static-crawl vs interactive-explore. */
export interface ProductSignals {
  hasCanvas: boolean;
  /** the largest canvas' pixel area (width×height), 0 if none. */
  canvasArea: number;
  webgl: boolean;
  keyListeners: boolean;
  gamepad: boolean;
  spaRouting: boolean;
  /** the DOM changed on its own between two samples, with NO interaction — a live/animated experience. */
  selfAnimates: boolean;
  nodeCount: number;
  renderedTextLen: number;
  rawHtmlTextLen: number;
  hasServiceWorker: boolean;
}

/**
 * Decide the product mode from real signals. A product is INTERACTIVE (an app to be USED, not a page
 * to be read) when it is a thin shell that is doing something the DOM alone can't express by sitting
 * still: a substantial game canvas, OR a thin surface that self-animates or listens for keys/gamepad
 * (e.g. yara.garden — an emoji world with no canvas at all). Otherwise it is a content site we crawl
 * exactly as before. Text-rich pages are always static (a dashboard's pages ARE crawlable). Pure.
 */
export function classifyMode(
  s: ProductSignals,
  /** true when the founder asked for something a tester must DO, not merely read. */
  goalRequiresUse = false,
): ProductMode {
  // THE FOUNDER'S INTENT OUTRANKS THE RENDER. Every branch below needs `thinText` (<600 chars), so a
  // text-rich app could never be explored — Sage crawled six pages of its OWN site and never clicked
  // anything, then failed for want of grounded evidence. "A dashboard's pages ARE crawlable" is true
  // for READING a product and false for USING one: "make users launch a campaign" cannot be verified
  // by reading HTML, only by clicking Launch and filling the form. When the goal names work a tester
  // must perform, Sage uses the product regardless of how much text it renders.
  if (goalRequiresUse) return "interactive";
  const bigCanvas = s.hasCanvas && s.canvasArea >= CANVAS_MIN_AREA;
  const thinText = s.renderedTextLen < 600;
  // a game / rendered experience on a canvas
  if (bigCanvas && (s.webgl || s.keyListeners || s.gamepad || thinText))
    return "interactive";
  if (s.gamepad && s.hasCanvas) return "interactive";
  // a thin, self-animating or input-driven DOM experience — no canvas required
  if (thinText && (s.selfAnimates || s.keyListeners || s.gamepad))
    return "interactive";
  if (s.spaRouting && thinText && (bigCanvas || s.selfAnimates))
    return "interactive";
  return "static";
}

/**
 * The honest jsOnly fix (spec 5): near-zero visible text in BOTH the raw HTML and the rendered DOM,
 * with a real canvas, is an INTERACTIVE APP — never "0 JavaScript-only pages". Pure.
 */
export function isInteractiveApp(
  rawHtmlTextLen: number,
  renderedTextLen: number,
  hasBigCanvas: boolean,
): boolean {
  return hasBigCanvas && rawHtmlTextLen < 300 && renderedTextLen < 400;
}

/** A dependency-free visual fingerprint of a state (rendered-text volume, node count, canvas sample). */
export interface StateFingerprint {
  textLen: number;
  nodeCount: number;
  /** a coarse downsample of the largest canvas (0..255 values), or null (WebGL blank / no canvas). */
  canvasSample: number[] | null;
}

/** Approximate change % between two fingerprints, 0..100 — a best-effort visual-change signal. Pure. */
export function fingerprintDelta(
  a: StateFingerprint | null,
  b: StateFingerprint,
): number {
  if (!a) return 100;
  const pct = (x: number, y: number): number => {
    const max = Math.max(x, y, 1);
    return (Math.abs(x - y) / max) * 100;
  };
  let canvasDelta = 0;
  if (
    a.canvasSample &&
    b.canvasSample &&
    a.canvasSample.length === b.canvasSample.length &&
    a.canvasSample.length > 0
  ) {
    let diff = 0;
    for (let i = 0; i < a.canvasSample.length; i++)
      if (Math.abs(a.canvasSample[i] - b.canvasSample[i]) > 12) diff++;
    canvasDelta = (diff / a.canvasSample.length) * 100;
  }
  return Math.round(
    Math.max(
      pct(a.textLen, b.textLen),
      pct(a.nodeCount, b.nodeCount),
      canvasDelta,
    ),
  );
}

/** A drag gesture in viewport pixels — from → to, used to draw a stroke on a canvas surface. */
export interface Stroke {
  from: [number, number];
  to: [number, number];
}

/**
 * Plan `n` safe drag strokes INSIDE a canvas box, confined to its central 60% so a stroke never starts
 * on an overlaid toolbar/property panel (those hug the edges) and never leaves the surface. Deterministic
 * (no randomness — strokes are spread along a diagonal band), so the same box always yields the same
 * gestures. Pure + unit-testable; the browser layer just replays these coordinates with the mouse.
 */
export function canvasStrokes(
  box: { x: number; y: number; width: number; height: number },
  n = DRAW_STROKES,
): Stroke[] {
  const strokes: Stroke[] = [];
  if (box.width <= 0 || box.height <= 0 || n <= 0) return strokes;
  const padX = box.width * 0.2;
  const padY = box.height * 0.2;
  const innerW = box.width - padX * 2;
  const innerH = box.height - padY * 2;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1); // 0..1 along the band
    const fx = box.x + padX + innerW * (0.1 + 0.2 * t);
    const fy = box.y + padY + innerH * (0.15 + 0.6 * t);
    const tx = box.x + padX + innerW * (0.5 + 0.3 * t);
    const ty = box.y + padY + innerH * (0.35 + 0.55 * t);
    strokes.push({
      from: [Math.round(fx), Math.round(fy)],
      to: [Math.round(tx), Math.round(ty)],
    });
  }
  return strokes;
}

/**
 * A bounded, read-only pass over a product's OTHER pages, for URL-anchored evidence.
 *
 * Exploration proves a tester can DO something; a crawl yields evidence a mission can be checked
 * against from a public link — the url-verifiable class Sage can confirm and pay without judging an
 * account. They answer different questions, so an interactive run wants both. Never throws: the
 * caller keeps its exploration summary whatever happens here.
 */
async function crawlPagesForUrlEvidence(
  context: BrowserContext | null,
  startUrl: string,
  candidateLinks: readonly string[],
  host: string,
  max = 3,
): Promise<FieldTestCapture[]> {
  if (!context) return [];
  const urls = [
    ...new Set(
      candidateLinks
        .map((u) => {
          try {
            const url = new URL(u, startUrl);
            return sameSiteHost(url.host, host) ? url.toString() : null;
          } catch {
            return null;
          }
        })
        .filter((u): u is string => !!u),
    ),
  ].slice(0, max);
  const caps: FieldTestCapture[] = [];
  for (const url of urls) {
    const page = await context.newPage().catch(() => null);
    if (!page) continue;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
      await settleLazyContent(page);
      const title = (await page.title().catch(() => "")).slice(0, 200);
      const h1 = (
        await page.locator("h1").first().innerText({ timeout: 1000 }).catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      const renderedTextLen = await page
        .evaluate(() => document.body?.innerText?.length ?? 0)
        .catch(() => 0);
      caps.push({
        url: page.url(),
        title,
        h1,
        ctas: await extractCtas(page),
        forms: await extractForms(page),
        consoleErrors: [],
        failedRequests: [],
        rawHtmlTextLen: renderedTextLen,
        renderedTextLen,
        screenshot: null,
        visibleTextExcerpt: await renderedExcerpt(page),
      });
    } catch {
      /* skip this page */
    } finally {
      await page.close().catch(() => {});
    }
  }
  return caps;
}

/** Build the durable STATIC summary from raw captures — caps CTAs, filters broken requests. Pure. */
export function buildFieldTestSummary(input: {
  startUrl: string;
  captures: FieldTestCapture[];
  durationMs: number;
  limitation: string | null;
  /** docs read because the product's front door was a wall — see the doc hunt. */
  docs?: DocPage[];
}): FieldTestSummary {
  const pages = input.captures.slice(0, MAX_PAGES).map((c) => ({
    url: c.url,
    title: c.title,
    h1: c.h1,
    ctas: c.ctas.slice(0, MAX_CTAS),
    forms: c.forms,
    consoleErrors: c.consoleErrors,
    brokenRequests: c.failedRequests.filter((r) => r.status >= 400),
    jsOnly: computeJsOnly(c.rawHtmlTextLen, c.renderedTextLen),
    screenshot: c.screenshot,
    ...(c.visibleTextExcerpt ? { visibleTextExcerpt: c.visibleTextExcerpt } : {}),
  }));
  return {
    ran: pages.length > 0,
    startUrl: input.startUrl,
    mode: "static",
    pages,
    states: [],
    classification: null,
    limitation: input.limitation,
    durationMs: input.durationMs,
    ...(input.docs && input.docs.length > 0 ? { docs: input.docs } : {}),
    ...(() => {
      const t = viewTruncations([], pages);
      return t.length > 0 ? { truncations: t } : {};
    })(),
  };
}

/** Link text or path that names a product's own documentation. */
/**
 * A LINK THAT NAMES DOCUMENTATION. This is Sage's answer key when a wall stops it, so a miss here is
 * not cosmetic: it decides whether Sage has any ground truth about what lives behind the login, and
 * therefore whether a tester's account of that place can ever be VERIFIED and PAID.
 *
 * MEASURED on token-watcher (AmtTLqredN1T): the homepage links "Read install notes" and calls itself
 * "sdk-first". The old pattern knew docs/guide/tutorial/faq but not install/setup/sdk/api/reference,
 * so Sage walked past the one page describing everything behind the wall, read 0 docs, and then
 * designed three missions about the console and the request ledger it had never seen. Every one of
 * those submissions would have HELD, because the corpus they'd be judged against was empty.
 */
const DOC_NAME =
  /(^|[^a-z])(docs?|documentation|guide|guides|tutorial|learn|faq|help|whitepaper|litepaper|how[-\s]?it[-\s]?works|getting[-\s]?started|quickstart|install\w*|setup|set[-\s]up|sdk|api|reference|readme|manual|integrat\w+|develop(?:er|ers|ment)|(?:install|release|setup)[-\s]?notes)([^a-z]|$)/i;
/**
 * Where a product's documentation conventionally lives, tried only when nothing was linked. Ordered
 * by how likely each is to explain the product rather than the company.
 */
const DOC_FALLBACK_PATHS = [
  "/docs",
  "/documentation",
  "/guide",
  "/how-it-works",
  "/learn",
  "/faq",
] as const;

/**
 * WHERE TO LOOK WHEN A WALL STOPS SAGE. Pure, so the ranking is testable without a browser.
 *
 * A wallet-connect or sign-in wall hides the half of a web3 product that actually matters. Sage
 * cannot walk through it, but the product almost always DOCUMENTS what is behind it, and reading that
 * is the difference between "I was blocked, here is a mission about your landing page" and "I was
 * blocked, but your docs say a connected user lands on a portfolio view, so here is a mission for
 * someone who has a wallet."
 *
 * Prefers paths the product itself LINKED (real navigation beats guessing), falls back to convention,
 * and never returns the page Sage was already turned away from.
 */
export function docCandidates(
  linked: { path: string; label: string }[],
  opts: { exclude?: string[]; limit?: number } = {},
): string[] {
  const exclude = new Set(opts.exclude ?? []);
  const limit = opts.limit ?? 3;
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (p: string) => {
    const clean = p.split("#")[0];
    if (!clean.startsWith("/") || seen.has(clean) || exclude.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };
  // 1. what the product linked and NAMED as documentation — the strongest signal there is.
  for (const l of linked) {
    if (out.length >= limit) break;
    if (DOC_NAME.test(l.label) || DOC_NAME.test(l.path)) take(l.path);
  }
  // 2. convention, only to fill remaining slots.
  for (const p of DOC_FALLBACK_PATHS) {
    if (out.length >= limit) break;
    take(p);
  }
  return out.slice(0, limit);
}

/**
 * What the {@link BRAIN_VIEW_CAPS} actually cost on THIS product. Pure, and deliberately derived from
 * the same constants the view builder uses, so the two can never disagree.
 *
 * Only real losses are reported: a product that fits under every cap returns an empty list, so a
 * non-empty `truncations` always means the brain was reasoning about less than Sage saw.
 */
export function viewTruncations(
  states: FieldTestState[],
  pages: FieldTestPage[],
): Truncation[] {
  const out: Truncation[] = [];
  const add = (
    at: string,
    kept: number,
    dropped: number,
    unit: Truncation["unit"],
  ) => {
    if (dropped > 0) out.push({ at, kept, dropped, unit });
  };

  add(
    "states",
    Math.min(states.length, BRAIN_VIEW_CAPS.states),
    Math.max(0, states.length - BRAIN_VIEW_CAPS.states),
    "states",
  );
  add(
    "crawled pages",
    Math.min(pages.length, BRAIN_VIEW_CAPS.pages),
    Math.max(0, pages.length - BRAIN_VIEW_CAPS.pages),
    "pages",
  );

  // Only states the brain will actually receive can lose anything — the rest are already counted above.
  const shown = states.slice(0, BRAIN_VIEW_CAPS.states);
  const textDropped = shown.reduce(
    (n, s) =>
      n + Math.max(0, s.visibleTextExcerpt.length - BRAIN_VIEW_CAPS.stateTextChars),
    0,
  );
  const textKept = shown.reduce(
    (n, s) =>
      n + Math.min(s.visibleTextExcerpt.length, BRAIN_VIEW_CAPS.stateTextChars),
    0,
  );
  add("state text", textKept, textDropped, "characters");

  const elDropped = shown.reduce(
    (n, s) =>
      n +
      Math.max(
        0,
        s.notableElements.length - BRAIN_VIEW_CAPS.notableElementsPerState,
      ),
    0,
  );
  const elKept = shown.reduce(
    (n, s) =>
      n +
      Math.min(
        s.notableElements.length,
        BRAIN_VIEW_CAPS.notableElementsPerState,
      ),
    0,
  );
  add("elements per state", elKept, elDropped, "elements");

  const pageTextDropped = pages
    .slice(0, BRAIN_VIEW_CAPS.pages)
    .reduce(
      (n, p) =>
        n +
        Math.max(
          0,
          (p.visibleTextExcerpt?.length ?? 0) - BRAIN_VIEW_CAPS.pageTextChars,
        ),
      0,
    );
  const pageTextKept = pages
    .slice(0, BRAIN_VIEW_CAPS.pages)
    .reduce(
      (n, p) =>
        n +
        Math.min(
          p.visibleTextExcerpt?.length ?? 0,
          BRAIN_VIEW_CAPS.pageTextChars,
        ),
      0,
    );
  add("page text", pageTextKept, pageTextDropped, "characters");

  return out;
}

/** Build the durable INTERACTIVE summary from the observed state log. Pure. */
export function buildInteractiveSummary(input: {
  startUrl: string;
  states: FieldTestState[];
  durationMs: number;
  limitation: string | null;
}): FieldTestSummary {
  const states = input.states.slice(0, MAX_INTERACTIONS + 6);
  return {
    ran: states.length > 0,
    startUrl: input.startUrl,
    mode: "interactive",
    pages: [],
    states,
    classification:
      states.length > 0 ? interactiveClassification(states) : null,
    limitation: input.limitation,
    durationMs: input.durationMs,
    ...(() => {
      const t = viewTruncations(states, []);
      return t.length > 0 ? { truncations: t } : {};
    })(),
  };
}

/**
 * The honest one-line classification: how many distinct states Sage reached AND how many distinct UI
 * elements it saw across them — "show work, not spinners." A higher element count is the visible proof
 * that the deep-exploration pass actually opened panels/menus, not just clicked through top-level screens.
 * Pure.
 */
export function interactiveClassification(states: FieldTestState[]): string {
  const elements = new Set<string>();
  for (const s of states)
    for (const e of s.notableElements ?? [])
      if (e.text) elements.add(e.text.toLowerCase());
  const el = elements.size;
  return `Interactive app detected · ${states.length} states, ${el} element${el === 1 ? "" : "s"} explored`;
}

/**
 * P23 — Sage's exploration BREADTH from a field-test summary, for the "Sage explored this product itself:
 * N screens, M elements" board line. Screens = states reached (interactive) or pages crawled (static);
 * elements = distinct UI things seen (notable elements interactive, CTAs static). Pure; 0/0 when nothing ran.
 */
export function explorationCounts(
  summary: FieldTestSummary | null | undefined,
): { screens: number; elements: number } {
  if (!summary?.ran) return { screens: 0, elements: 0 };
  const elements = new Set<string>();
  if (summary.mode === "interactive") {
    for (const s of summary.states)
      for (const e of s.notableElements ?? [])
        if (e.text) elements.add(e.text.toLowerCase());
    return { screens: summary.states.length, elements: elements.size };
  }
  for (const p of summary.pages)
    for (const c of p.ctas ?? []) if (c) elements.add(c.toLowerCase());
  return { screens: summary.pages.length, elements: elements.size };
}

/**
 * The compact projection fed to the Mission Brain (stays inside the UNTRUSTED boundary). Static
 * mode keeps today's per-page shape; interactive mode surfaces the observed state log so a mission
 * can only be anchored to a state Sage actually reached.
 */
export function fieldTestForMap(summary: FieldTestSummary):
  | {
      mode: "static";
      pages: Array<{
        url: string;
        title: string;
        ctas: string[];
        consoleErrors: string[];
        brokenRequests: { url: string; status: number }[];
        jsOnly: boolean;
        visibleTextExcerpt?: string;
      }>;
      /** DOCUMENTATION read because the product's FRONT DOOR was a wall. Same labelling rule as the
       *  interactive branch: the brain must never mistake "the product documents this" for "Sage
       *  watched this happen". */
      docs?: Array<{ url: string; title: string; excerpt: string; soughtBecause: string }>;
    }
  | {
      mode: "interactive";
      classification: string | null;
      states: Array<{
        trigger: string;
        visibleTextExcerpt: string;
        notableElements: { tag: string; text: string; role: string }[];
        url: string;
      }>;
      /** crawled PAGES that accompanied the exploration (url-anchored evidence for url missions). */
      pages?: Array<{ url: string; title: string; ctas: string[]; visibleTextExcerpt?: string }>;
      /** DOCUMENTATION read because a wall blocked the product. Labelled separately so the brain can
       *  never mistake "the product documents this" for "Sage watched this happen". */
      docs?: Array<{ url: string; title: string; excerpt: string; soughtBecause: string }>;
    } {
  // 2000 chars per page for the architect (was 500): the missions must come from what Sage SAW, and
  // 500 chars is one hero section — pricing/features/how-it-works all live further down. Worst case
  // 6 pages × 2000 ≈ 3k tokens of prompt, well inside the models' context and the battery's cost cap.
  const pageView = (p: FieldTestSummary["pages"][number]) => ({
    url: p.url,
    title: p.title,
    ctas: p.ctas.slice(0, BRAIN_VIEW_CAPS.ctasPerPage),
    ...(p.visibleTextExcerpt
      ? {
          visibleTextExcerpt: p.visibleTextExcerpt.slice(
            0,
            BRAIN_VIEW_CAPS.pageTextChars,
          ),
        }
      : {}),
  });
  if (summary.mode === "interactive") {
    return {
      mode: "interactive",
      classification: summary.classification,
      states: summary.states.slice(0, BRAIN_VIEW_CAPS.states).map((s) => ({
        trigger: s.trigger,
        visibleTextExcerpt: s.visibleTextExcerpt.slice(
          0,
          BRAIN_VIEW_CAPS.stateTextChars,
        ),
        notableElements: s.notableElements.slice(
          0,
          BRAIN_VIEW_CAPS.notableElementsPerState,
        ),
        url: s.url,
      })),
      // The crawled pages ride along (bounded): an interactive product with readable pages can then
      // still be given a url-verifiable mission — the architect needs page TEXT to cite, and hiding
      // it here was why interactive plans drifted observation-only (the url-mission floor's cause).
      ...(summary.pages.length > 0
        ? { pages: summary.pages.slice(0, BRAIN_VIEW_CAPS.pages).map(pageView) }
        : {}),
      ...(summary.docs?.length
        ? { docs: summary.docs.slice(0, BRAIN_VIEW_CAPS.pages) }
        : {}),
    };
  }
  return {
    mode: "static",
    pages: summary.pages.map((p) => ({
      ...pageView(p),
      consoleErrors: p.consoleErrors.slice(0, 5),
      brokenRequests: p.brokenRequests.slice(0, 5),
      jsOnly: p.jsOnly,
    })),
    // A static run reaches here BECAUSE the front door was a wall, so its docs are the only account
    // of what a signed-in user sees. Projecting them on the interactive branch alone meant the brain
    // never received the very pages the hunt exists to fetch.
    ...(summary.docs?.length
      ? { docs: summary.docs.slice(0, BRAIN_VIEW_CAPS.pages) }
      : {}),
  };
}

/**
 * Why a run read HTML instead of driving the product — or null when "static" was a genuine
 * classification of a genuine content site.
 *
 * Both arrive at mode "static", and both used to record `limitation: null` as long as the HTML
 * crawl found any page, which makes them indistinguishable afterwards. Measured: allbirds.com and
 * web.telegram.org each flipped between interactive and static in BOTH directions on 2026-08-06 —
 * allbirds saw 13 browser states in one run and 0 the next hour, same URL, and the founder gets a
 * materially different plan depending on which run they catch with nothing in the record saying so.
 *
 * A blocked door outranks "no page found": it is the more specific truth and the one a founder can
 * act on. Says only what was observed — that Sage was turned away — and never diagnoses the
 * product, because "your site blocks bots" is a guess and "Sage could not open it" is a fact.
 */
/** The known wallet providers a connect modal offers. Two of these together in one dialog is the
 *  reliable "this is a wallet wall" signal — one name anywhere in the chrome is not. */
const WALLET_PROVIDERS = [
  "metamask", "walletconnect", "coinbase wallet", "rainbow", "phantom",
  "trust wallet", "ledger", "rabby", "okx wallet", "brave wallet", "argent", "safe",
];

export interface WallSignals {
  hasVisiblePassword: boolean;
  /** text of an OPEN, VISIBLE dialog (a wallet modal is one; a persistent header is not). */
  dialogText: string;
  /** the page's own visible text, first few kB. */
  bodyText: string;
  /** the URL path names an auth page (/login, /signin, /signup, /register, /auth). */
  pathIsAuth?: boolean;
}

/**
 * WHICH BOUNDARY, IF ANY, SAGE HAS REACHED — pure so the rules are provable without a browser.
 *
 * A boundary is one Sage must not cross: a login, a connect-wallet prompt, or a third-party sign-in.
 * The hard part is telling a real WALL from a persistent affordance: a web3 app shows "Connect
 * Wallet" in its header on every page, exactly as a shop keeps a hidden login drawer mounted
 * everywhere. Neither is a wall Sage walked into. So the wallet signal requires a BLOCKING prompt —
 * an open dialog offering two or more wallet providers (what appears after clicking Connect), or the
 * page's own content asking to connect/sign in *to continue* — never a lone control.
 */
export function classifyWallKind(s: WallSignals): "password" | "wallet" | "oauth" | null {
  if (s.hasVisiblePassword) return "password";
  /**
   * A LOGIN PAGE IS A WALL EVEN WITHOUT A PASSWORD FIELD. Measured on clawup.org: "Start Free" led
   * to /login, which offers OAuth buttons / an email-first flow — no visible password, no blocking
   * dialog — so nothing classified, no wallNote was set, the doc hunt never fired, and the explorer
   * retreated via the site logo TWICE. The founder asked for "make an account and launch an agent";
   * the plan came back about brand assets and terms, because those were the only pages Sage could
   * anchor to. Path-based on purpose: a hidden login drawer is mounted on EVERY page (the allbirds
   * 4-states→0 trap), but a URL whose path says /login names the page's own purpose, and auth
   * affordances on THAT page are the page, not furniture.
   */
  if (s.pathIsAuth && /\b(sign in|log in|sign up|create (an |your )?account|continue with|get started)\b/i.test(s.bodyText || "")) {
    return "password";
  }
  const dlg = (s.dialogText || "").toLowerCase();
  if (dlg) {
    const providerHits = WALLET_PROVIDERS.filter((w) => dlg.includes(w)).length;
    if (providerHits >= 2 || (providerHits >= 1 && /connect\s+(a\s+|your\s+)?wallet/.test(dlg))) {
      return "wallet";
    }
    if (/(sign in|continue|log in|sign up)\s+with\s+(google|github|apple|discord|twitter|x|facebook|microsoft)/.test(dlg)) {
      return "oauth";
    }
  }
  const body = (s.bodyText || "").toLowerCase().slice(0, 4000);
  if (/connect\s+(a\s+|your\s+)?wallet\s+to\s+(continue|access|view|start|use|get started|launch|create)/.test(body)) {
    return "wallet";
  }
  if (
    /(sign in|log in|sign up)\s+to\s+(continue|access|view|start|use|get started)/.test(body) &&
    /(sign in|continue|log in)\s+with\s+(google|github|apple|discord|twitter|x|facebook|microsoft)/.test(body)
  ) {
    return "oauth";
  }
  return null;
}

/**
 * Read the wall signals off a loaded page. Extraction only — the RULES live in the pure
 * {@link classifyWallKind}, so they stay provable without a browser. Shared by both paths: the
 * explorer asks after each navigation, and the static path asks about the ENTRY page, because a
 * product whose front door is the wall never reaches the explorer at all.
 */
async function wallSignalsOf(page: Page): Promise<WallSignals | null> {
  return page
    .evaluate(() => {
      const shown = (el: Element) => {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width < 8 || rect.height < 8) return false;
        const st = getComputedStyle(he);
        if (st.visibility === "hidden" || st.display === "none") return false;
        if (Number(st.opacity) === 0) return false;
        let p = he.parentElement;
        for (let depth = 0; p && depth < 12; depth++) {
          const ps = getComputedStyle(p);
          if (Number(ps.opacity) === 0) return false;
          const clip = `${ps.overflow}${ps.overflowX}${ps.overflowY}`;
          if (clip.includes("hidden") || clip.includes("clip")) {
            const pr = p.getBoundingClientRect();
            if (pr.width < 8 || pr.height < 8) return false;
          }
          p = p.parentElement;
        }
        return true;
      };
      const hasVisiblePassword = Array.from(
        document.querySelectorAll('input[type="password"]'),
      ).some(shown);
      // The text of an OPEN, VISIBLE dialog only — a wallet modal is one, a persistent header is
      // not — so a lone nav "Connect Wallet" never reads as a wall.
      const dlg = Array.from(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]'),
      ).find(shown);
      return {
        hasVisiblePassword,
        dialogText: (dlg?.textContent || "").slice(0, 2000),
        bodyText: (document.body?.innerText || "").slice(0, 4000),
        pathIsAuth: /(^|\/)(log-?in|sign-?in|sign-?up|register|auth)(\/|$)/i.test(location.pathname),
      };
    })
    .catch(() => null);
}

/** The human-readable note for a wall Sage will not cross, used as the doc hunt's stated reason. */
export function wallNoteFor(kind: "password" | "wallet" | "oauth"): string {
  return kind === "wallet"
    ? "connect-wallet required past this point"
    : kind === "oauth"
      ? "third-party sign-in required past this point"
      : "login required past this point";
}

/**
 * THE DOC HUNT — read what the product says about the half Sage cannot reach.
 *
 * Runs only when a wall actually stopped Sage, so no ordinary product pays for it. Shared by both
 * paths on purpose: it first shipped inside the explorer, which meant a product classified `static`
 * could never reach it, and "the whole app is behind a connect screen" is the single most common
 * web3 shape. A wall at the front door is MORE deserving of the hunt, not less.
 */
async function huntDocs(ctx: {
  page: Page;
  startUrl: string;
  wallNote: string;
  linkedPaths: { path: string; label: string }[];
  walledPaths: string[];
  deadline: number;
  sameOrigin: (u: string) => boolean;
  /** absolute doc-labeled links harvested during exploration — may live on a docs.<domain> subdomain. */
  docUrls?: { url: string; label: string }[];
  /** the explorer records a state per doc read; the static path has no filmstrip to add to. */
  onRead?: (path: string) => Promise<unknown>;
  /** live-trail narration for the hunt itself — every candidate probe is up to 14s of goto +
   *  networkidle, and a run of walls/404s used to be a silent minute on the founder's screen. */
  narrate?: (label: string) => void;
  /** true when the browser is SIGNED IN — doc text must then be redacted before it becomes corpus. */
  authenticated?: boolean;
  /** the credential values, so an echoed email/password is stripped too. Never logged. */
  credentials?: { email: string; password: string };
}): Promise<DocPage[]> {
  const docs: DocPage[] = [];
  // The product's own labelled documentation links come FIRST — real navigation beats convention.
  // Off-host is allowed ONLY for these, and only on the same registrable domain as the product:
  // docs.clawup.org for clawup.org. The egress guard still validates every fetch as public https.
  const registrable = (h: string) => h.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
  let productTail = "";
  try {
    productTail = registrable(new URL(ctx.startUrl).host);
  } catch {
    /* no absolute-doc reads without a parseable start */
  }
  const absolute = (ctx.docUrls ?? []).filter((d) => {
    try {
      return productTail !== "" && registrable(new URL(d.url).host) === productTail;
    } catch {
      return false;
    }
  });
  const candidates = [
    ...absolute.map((d) => d.url),
    ...docCandidates(ctx.linkedPaths, { exclude: ctx.walledPaths }),
  ];
  if (candidates.length > 0) ctx.narrate?.("blocked by a wall — hunting for public documentation");
  for (const p of candidates) {
    if (Date.now() > ctx.deadline) break; // the wall clock still governs everything
    // ENOUGH IS ENOUGH: with three real doc pages in hand, another guess only delays the founder —
    // and the guesses are where the 404s live. Real linked docs sort first, so this stops the
    // conventional-path probing exactly when it stops buying anything.
    if (docs.length >= 3) break;
    try {
      const target = new URL(p, ctx.startUrl);
      // An absolute doc link already passed the registrable-domain filter above; a relative candidate
      // must still be same-origin. The egress guard validates either as public https at fetch time.
      const isAbsoluteDoc = absolute.some((d) => d.url === p);
      if (!isAbsoluteDoc && !ctx.sameOrigin(target.toString())) continue;
      ctx.narrate?.(`checking ${target.host}${target.pathname === "/" ? "" : target.pathname} for docs`);
      const resp = await ctx.page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });
      /**
       * A 404 IS NOT DOCUMENTATION, and it must never reach the founder's filmstrip.
       *
       * Measured on the first real clawup campaign run: the true docs (docs.clawup.org, three
       * pages of 2000 chars) were already in hand, and the hunt then tried the conventional
       * /docs, /documentation and /guide guesses anyway. ClawUp's Next.js 404 renders 247 chars
       * of nav + footer shell, which cleared the old 200-char floor — so THREE 404 screenshots
       * were captured as "read the docs", and the last thing the founder watched during the
       * multi-minute design wait was a dead page. Guard by HTTP status first (the truth), then
       * by 404 wording (SPAs that soft-200 their not-found page), then a floor high enough that
       * a nav shell cannot clear it.
       */
      if ((resp?.status() ?? 0) >= 400) continue;
      await ctx.page
        .waitForLoadState("networkidle", { timeout: 4_000 })
        .catch(() => {});
      const excerpt = await renderedExcerpt(ctx.page);
      const docTitle = await ctx.page.title().catch(() => "");
      if (/\b(404|page (?:could )?not (?:be )?found|page doesn'?t exist)\b/i.test(`${docTitle} ${excerpt.slice(0, 300)}`)) continue;
      if (excerpt.trim().length < 400) continue;
      // A doc read while SIGNED IN can show account-specific content (an API key on a quick-start
      // page, the signed-in email in a header). Docs are harvested outside capture(), so the
      // redaction that protects states must be applied here explicitly — same rule, same reason:
      // excerpts become corpus, and corpus becomes public mission anchors.
      const safeTitle = ctx.authenticated ? redactSecrets(docTitle, ctx.credentials) : docTitle;
      const safeExcerpt = ctx.authenticated ? redactSecrets(excerpt, ctx.credentials) : excerpt;
      docs.push({
        url: target.toString(),
        title: safeTitle.slice(0, 140),
        excerpt: safeExcerpt.slice(0, BRAIN_VIEW_CAPS.pageTextChars),
        soughtBecause: ctx.wallNote,
      });
      await ctx.onRead?.(p);
    } catch {
      /* a doc page that will not load is simply not evidence — carry on */
    }
  }
  return docs;
}

export function turnedAwayLimitation(
  entryBlocked: string | null,
  sawChallenge: boolean,
): string | null {
  if (entryBlocked) {
    return `Sage could not open this product in a browser (${entryBlocked.slice(0, 80)}), so this run read its HTML only and saw less than a person would.`;
  }
  if (sawChallenge) {
    return "Sage met a bot challenge on the entry page, so this run read the product's HTML rather than using it, and saw less than a person would.";
  }
  return null;
}

/* ────────────────────── the Playwright orchestration (lazy, isolated) ─────── */

export interface FieldTestDeps {
  /** default: resolvesPublic (DNS public-host check). Overridable so a local-fixture test can allow 127.0.0.1. */
  isPublicHost?: (host: string) => Promise<boolean>;
  /** default: requestGuard. Overridable for the same reason. */
  allowUrl?: (url: string) => { allow: boolean; reason: string };
  /** default: <cwd>/public. Tests point this at a tmp dir. */
  publicDir?: string;
  /** TEST-ONLY: exact "host:port" destinations the egress proxy may reach despite being loopback. */
  egressAllowLoopback?: ReadonlySet<string>;
  /** TEST-ONLY: extra proxy destination ports (local fixtures use random ports). */
  egressAllowedPorts?: ReadonlySet<number>;
  /** TEST-ONLY: proxy DNS override (simulate rebinding / mixed records). */
  egressLookup?: (
    host: string,
  ) => Promise<{ address: string; family: number }[]>;
  /** Goal-directed controller deps (a scripted `complete` for fixtures; real multimodal model otherwise). */
  controller?: DecideDeps;
}

/**
 * Field-test a product. Detects the product mode on entry, then EITHER crawls same-origin pages
 * (static) OR runs the interactive state machine (a client app / game). Never throws — any failure
 * returns a summary with `ran:false` (or partial output) and an honest `limitation`.
 */
async function runFieldTestInner(
  opts: {
    inspectionId: string;
    startUrl: string;
    host: string;
    candidateLinks: string[];
    goal?: string;
    /** the founder's compiled ordered journey — drives WHICH target Sage pursues next. */
    journey?: GoalJourneyV1 | null;
    /** The founder's OPTIONAL test account — password walls only. Values are never logged, never
     *  captured into a state, and never reach a prompt; authenticated text is redacted at capture. */
    testAccount?: { email: string; password: string; mailbox?: MailboxAccess | null } | null;
  },
  deps: FieldTestDeps = {},
): Promise<FieldTestSummary> {
  const isPublicHost = deps.isPublicHost ?? resolvesPublic;
  const allowUrl = deps.allowUrl ?? requestGuard;
  const publicDir = deps.publicDir ?? path.join(process.cwd(), "public");
  const started = Date.now();
  const degrade = (limitation: string): FieldTestSummary => ({
    ran: false,
    startUrl: opts.startUrl,
    mode: "static",
    pages: [],
    states: [],
    classification: null,
    limitation,
    durationMs: Date.now() - started,
  });

  // 1. entry gate — same SSRF/public-host check as the HTML inspector.
  const entry = allowUrl(opts.startUrl);
  if (!entry.allow) return degrade(`Field test skipped: ${entry.reason}.`);
  let entryHost: string;
  try {
    entryHost = new URL(opts.startUrl).hostname;
  } catch {
    return degrade("Field test skipped: unparseable entry URL.");
  }
  if (!(await isPublicHost(entryHost)))
    return degrade("Field test skipped: host resolves to a private address.");

  // 2. lazy-load the browser engine — optional dependency; absent → honest degrade.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return degrade(
      "Field test unavailable: browser engine not installed (run: npx playwright install --with-deps chromium).",
    );
  }

  const deadline = started + TOTAL_MS;
  const hostCache = new Map<string, boolean>();
  const publicHostCached = async (h: string): Promise<boolean> => {
    const cached = hostCache.get(h);
    if (cached !== undefined) return cached;
    const ok = await isPublicHost(h);
    hostCache.set(h, ok);
    return ok;
  };

  // The LIVE product host. Starts as the caller's host and is REBASED onto the host the entry page
  // actually lands on (post-redirect), so an apex→www or marketing→app redirect doesn't turn every
  // subsequent same-site check false (which made the explorer goBack() after every single action).
  // Scope only — safety stays with the egress proxy + SSRF guard on every request.
  let liveHost = opts.host;
  const sameOrigin = (u: string): boolean => {
    try {
      return sameSiteHost(new URL(u).host, liveHost);
    } catch {
      return false;
    }
  };
  const seenTargets = new Set<string>();
  /**
   * LEGAL BOILERPLATE GOES LAST. The crawl took candidate links in document order, and a footer's
   * /terms, /privacy and /brand-assets sit in every page's HTML — so the first real campaign run
   * showed a founder "Surfaces: / · /brand-assets · /terms · /privacy" as what Sage inspected,
   * while the product's actual pages lost their crawl slots to boilerplate. Stable partition, not
   * a filter: legal pages still crawl when slots remain (a terms page can matter), they just never
   * again displace the product.
   */
  const LEGAL_PATH = /\/(terms|privacy|legal|cookies?|imprint|disclaimer|brand-?assets?|press|licen[cs]e)(\/|$)/i;
  const ordered = [opts.startUrl, ...opts.candidateLinks.filter(sameOrigin)]
    .map((u) => u.replace(/#.*$/, ""))
    .filter((u) => (seenTargets.has(u) ? false : (seenTargets.add(u), true)));
  const targets = [
    ...ordered.filter((u) => !LEGAL_PATH.test(u)),
    ...ordered.filter((u) => LEGAL_PATH.test(u)),
  ].slice(0, MAX_PAGES);

  const artifactDir = path.join(publicDir, "field-tests", opts.inspectionId);
  // Per-transition egress methods — the request interceptor records each allowed request's method, and
  // capture() drains them into the state, so a transition's safety can be POSITIVELY established
  // (GET/HEAD-only → safe; a mutating method → state_changing; nothing recorded → unverified).
  const methodsSinceCapture: string[] = [];
  // AUTHORITATIVE egress boundary — every browser request exits through this local proxy, which resolves +
  // validates + pins each destination (defeats DNS-rebinding/TOCTOU). Production allowlists nothing.
  const proxy = await startEgressProxy({
    allowLoopback: deps.egressAllowLoopback,
    allowedPorts: deps.egressAllowedPorts,
    lookup: deps.egressLookup,
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      proxy: { server: proxy.url },
      args: proxy.chromiumArgs,
    });
    // A REALISTIC browser identity. The old "SageFieldTest/1.0" UA got the field test bot-walled
    // (403/challenge page) on any WAF-fronted product, so exploration saw a challenge screen instead
    // of the product — the honest marker moves to a header a site operator can still allowlist.
    context = await browser.newContext({
      userAgent: BROWSER_UA,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-sage-agent": "SageFieldTest/1.0 (+read-only product field test)" },
    });
    // Instrument BEFORE any page script runs: record which event listeners + SPA routing appear,
    // so mode detection reflects the real product, not a guess. Reads only; changes nothing.
    await context.addInitScript(() => {
      const w = window as unknown as { __sage?: Record<string, unknown> };
      w.__sage = { keydown: false, gamepad: false, pushState: 0 };
      const proto = EventTarget.prototype;
      const orig = proto.addEventListener;
      proto.addEventListener = function (type: string, ...rest: unknown[]) {
        if (type === "keydown" || type === "keyup")
          (w.__sage as Record<string, boolean>).keydown = true;
        if (type === "gamepadconnected")
          (w.__sage as Record<string, boolean>).gamepad = true;
        // @ts-expect-error variadic passthrough
        return orig.call(this, type, ...rest);
      };
      try {
        const ps = history.pushState;
        history.pushState = function (...a: unknown[]) {
          (w.__sage as Record<string, number>).pushState =
            ((w.__sage as Record<string, number>).pushState ?? 0) + 1;
          // @ts-expect-error variadic passthrough
          return ps.apply(this, a);
        };
      } catch {
        /* history not writable — skip */
      }
    });
    // DEFENSE-IN-DEPTH page-level guard (the egress proxy is the authoritative boundary): an early abort
    // for obviously-bad schemes/hosts. A plain route.continue() is safe — every request the browser makes,
    // redirect hops included, still exits through the proxy, which resolves + validates + pins it.
    await context.route("**/*", async (route: Route) => {
      const url = route.request().url();
      if (!allowUrl(url).allow) return void route.abort().catch(() => {});
      let h: string;
      try {
        h = new URL(url).hostname;
      } catch {
        return void route.abort().catch(() => {});
      }
      if (!(await publicHostCached(h)))
        return void route.abort().catch(() => {});
      methodsSinceCapture.push(route.request().method().toUpperCase()); // record egress methods per transition
      return void route.continue().catch(() => {});
    });

    // 3. entry page — load, gather signals, decide the mode.
    const entryPage = await context.newPage();
    const entryErrors: string[] = [];
    const entryFailed: { url: string; status: number }[] = [];
    entryPage.on("console", (m) => {
      if (m.type() === "error") entryErrors.push(m.text().slice(0, 300));
    });
    entryPage.on("response", (r) => {
      const s = r.status();
      if (s >= 400) entryFailed.push({ url: r.url().slice(0, 300), status: s });
    });

    let signals: ProductSignals | null = null;
    let entryRawTextLen = 0;
    /**
     * WHY THIS RUN MIGHT NOT HAVE DRIVEN THE PRODUCT.
     *
     * "static" arrives here two different ways: as a real classification of a real content site,
     * and as a fallback when the browser never got a usable look. Both used to record
     * `limitation: null` whenever the HTML crawl found any page at all, which makes them
     * indistinguishable after the fact.
     *
     * MEASURED: allbirds.com and web.telegram.org each flipped between interactive and static in
     * BOTH directions on 2026-08-06 — allbirds saw 13 browser states in one run and 0 the next
     * hour, on the same URL. The founder gets a materially different plan depending on which run
     * they catch, and nothing in the record says why. These two flags are the difference between
     * "this product is a content site" and "Sage was turned away at the door".
     */
    let entryBlocked: string | null = null;
    let sawChallenge = false;
    /** Set when the ENTRY page is itself a login/connect wall — the static path's doc-hunt trigger. */
    let staticWallKind: "password" | "wallet" | "oauth" | null = null;
    /** path -> the link's own words, harvested from the entry DOM, for the doc hunt's ranking. */
    const linkLabels = new Map<string, string>();
    try {
      // ONE retry on a failed entry load — a transient network/TLS flake used to zero out the whole
      // field test (static degrade with no captures) when a second attempt would have worked.
      let resp: Awaited<ReturnType<typeof entryPage.goto>> = null;
      for (let attempt = 0; attempt < 2 && !resp; attempt++) {
        try {
          resp = await entryPage.goto(targets[0] ?? opts.startUrl, {
            waitUntil: "domcontentloaded",
            timeout: PAGE_MS,
          });
        } catch (e) {
          if (attempt === 0) await entryPage.waitForTimeout(2_000);
          else throw e;
        }
      }
      try {
        const body = await resp?.text();
        if (body) entryRawTextLen = visibleTextLen(body);
      } catch {
        /* keep 0 */
      }
      await entryPage
        .waitForLoadState("networkidle", { timeout: PAGE_MS })
        .catch(() => {});
      // BOT-CHALLENGE PATIENCE — a WAF interstitial usually clears once its JS runs. Wait it out,
      // reload once, and continue with whatever landed; a real block degrades exactly as before.
      if (await looksLikeChallenge(entryPage)) {
        sawChallenge = true;
        await entryPage.waitForTimeout(6_000);
        await entryPage
          .reload({ waitUntil: "domcontentloaded", timeout: PAGE_MS })
          .catch(() => {});
        await entryPage
          .waitForLoadState("networkidle", { timeout: PAGE_MS })
          .catch(() => {});
      }
      // REBASE the live host onto where the product actually landed (post-redirect). Every hop was
      // validated by the egress boundary; this only fixes the same-site scope for the rest of the run.
      try {
        const landed = new URL(entryPage.url()).host;
        if (landed) liveHost = landed;
      } catch {
        /* keep the caller's host */
      }
      signals = await gatherSignals(entryPage, entryRawTextLen);
    } catch (err) {
      // Fall through to static, but RECORD IT. Degrading quietly is what made a blocked run look
      // exactly like a content site, and a founder cannot ask about a limitation nobody wrote down.
      entryBlocked = err instanceof Error ? err.message : String(err);
    }

    // the founder's intent, decided ONCE from the compiled journey (authoritative) or the goal's words.
    /**
     * NO GOAL MEANS SAGE DECIDES — and deciding requires LOOKING.
     *
     * The goal field is optional by design: a founder who gives only a URL is delegating the "what
     * should be tested" judgment to Sage. But goalRequiresUse("") is false, so an empty goal used
     * to fall through to whatever the entry-page signals happened to classify — on a JS-heavy
     * product that meant a static HTML read, boilerplate surfaces, and missions invented from a
     * landing page. An agent cannot decide what matters in a product it never used, so delegation
     * FORCES exploration rather than excusing it.
     */
    const delegated = !(opts.goal ?? "").trim();
    const requiresUse = delegated || goalRequiresUse(opts.goal, opts.journey ?? null);
    const mode: ProductMode = signals
      ? classifyMode(signals, requiresUse)
      : "static";

    if (mode === "interactive") {
      // the explorer's own DOM-harvested paths — merged into the url-evidence crawl below, so an SPA
      // whose static link list was empty still yields readable pages + url-verifiable evidence.
      const discoveredPaths: string[] = [];
      // hand the already-loaded entry page to the state machine.
      const summary = await exploreInteractive({
        page: entryPage,
        startUrl: opts.startUrl,
        inspectionId: opts.inspectionId,
        artifactDir,
        methodsSinceCapture,
        host: liveHost,
        started,
        discoveredPathsOut: discoveredPaths,
        signals: signals as ProductSignals,
        entryErrors,
        goal: opts.goal,
        journey: opts.journey ?? null,
        testAccount: opts.testAccount ?? null,
        // the routes the static crawl already found on this host, as paths. The explorer was
        // single-page: on a normal app the flow the founder named lives behind a link, and clicking
        // the hero button forever never gets there (13 identical clicks, one URL, zero progress).
        candidatePaths: [
          ...new Set(
            (opts.candidateLinks ?? [])
              .map((u) => {
                try {
                  const url = new URL(u, opts.startUrl);
                  return sameSiteHost(url.host, liveHost)
                    ? url.pathname + url.search
                    : null;
                } catch {
                  return null;
                }
              })
              .filter((p): p is string => !!p && p !== "/"),
          ),
        ].slice(0, 6),
        controllerDeps: deps.controller,
      });
      await entryPage.close().catch(() => {});
      // P14 — LOOK at the state screenshots with a vision model (cost-guarded: only when there is
      // more than one state to describe). Failure-isolated: if vision fails or is unconfigured, the
      // summary is returned exactly as the no-vision path (no visionObservations key at all).
      if (summary.states.length > 1) {
        try {
          const vision = await describeStatesWithVision(
            summary.states,
            artifactDir,
            { log: (m) => console.log(m) },
          );
          if (vision.length > 0) summary.visionObservations = vision;
        } catch {
          /* vision degraded — summary unchanged */
        }
      }
      // ALSO CRAWL THE PAGES. Exploration and crawling answer different questions: exploring proves a
      // tester can DO something, crawling yields the URL-anchored evidence a mission can be checked
      // against from a public link. Choosing one used to discard the other, and the generality battery
      // caught the cost — content-ish products lost their url-verifiable (cleanly auto-payable)
      // missions the moment intent turned exploration on. A bounded read-only pass, fully isolated:
      // any failure leaves the exploration summary exactly as it was.
      try {
        const pageCaps = await crawlPagesForUrlEvidence(
          context,
          opts.startUrl,
          [
            ...(opts.candidateLinks ?? []),
            // the explorer's DOM-harvested paths, absolutized — a client-rendered product's only links
            ...discoveredPaths
              .map((p) => {
                try {
                  return new URL(p, opts.startUrl).toString();
                } catch {
                  return null;
                }
              })
              .filter((u): u is string => !!u),
          ],
          liveHost,
        );
        if (pageCaps.length > 0) {
          const asPages = buildFieldTestSummary({
            startUrl: opts.startUrl,
            captures: pageCaps,
            durationMs: 0,
            limitation: null,
          }).pages;
          const pages = [...(summary.pages ?? []), ...asPages];
          // RECOMPUTE the starvation report now that pages exist. buildInteractiveSummary ran before
          // this crawl, so it measured an empty pages array — which is why interactive products only
          // ever reported element loss and never the page-text loss that static products showed. A
          // report that is silent about half the caps is the same invisibility it exists to end.
          const t = viewTruncations(summary.states, pages);
          return {
            ...summary,
            pages,
            ...(t.length > 0 ? { truncations: t } : { truncations: undefined }),
          };
        }
      } catch {
        /* the exploration stands on its own */
      }
      return summary;
    }

    // ── STATIC CRAWL (byte-identical to the prior behavior) ──────────────────
    const captures: FieldTestCapture[] = [];
    // reuse the already-loaded entry page as page 0 to avoid a re-fetch.
    try {
      await settleLazyContent(entryPage);
      const title = (await entryPage.title().catch(() => "")).slice(0, 200);
      const h1 = (
        await entryPage
          .locator("h1")
          .first()
          .innerText({ timeout: 1000 })
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      const ctas = await extractCtas(entryPage);
      const forms = await extractForms(entryPage);
      const renderedTextLen =
        signals?.renderedTextLen ??
        (await entryPage
          .evaluate(() => document.body?.innerText?.length ?? 0)
          .catch(() => 0));
      let screenshot: string | null = null;
      try {
        await fs.mkdir(artifactDir, { recursive: true });
        await entryPage.screenshot({
          path: path.join(artifactDir, `0.png`),
          fullPage: true,
        });
        screenshot = `/api/field-tests/${opts.inspectionId}/0`;
      } catch {
        screenshot = null;
      }
      captures.push({
        url: entryPage.url(),
        title,
        h1,
        ctas,
        forms,
        consoleErrors: entryErrors,
        failedRequests: entryFailed,
        rawHtmlTextLen: entryRawTextLen,
        renderedTextLen,
        screenshot,
        // the static crawl's OBSERVATIONS — real rendered text the corpus, key and architect can use.
        visibleTextExcerpt: await renderedExcerpt(entryPage),
      });
      // SPA LINK DISCOVERY — a client-rendered content site serves raw HTML with no links, so the
      // static inspector found nothing and `targets` holds only the entry URL. The RENDERED DOM is
      // where its navigation actually exists; harvest same-site links from it so a JS-rendered
      // product gets a real multi-page crawl instead of a one-page map.
      if (targets.length < MAX_PAGES) {
        const renderedLinks = await entryPage
          .evaluate(() =>
            Array.from(document.querySelectorAll("a[href]"))
              .map((a) => ({
                href: (a as HTMLAnchorElement).href,
                // the link's own words, so the doc hunt can find a "Documentation" link whose PATH
                // gives nothing away (/resources/2), not only the conventional /docs spellings.
                text: ((a as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
              }))
              .filter((l) => l.href)
              .slice(0, 40),
          )
          .catch(() => [] as { href: string; text: string }[]);
        for (const l of renderedLinks) {
          try {
            const u = new URL(l.href, entryPage.url());
            if (sameOrigin(u.toString())) linkLabels.set(u.pathname + u.search, l.text);
          } catch {
            /* skip unparseable */
          }
        }
        const rendered = renderedLinks.map((l) => l.href);
        for (const raw of rendered) {
          if (targets.length >= MAX_PAGES) break;
          try {
            const u = new URL(raw, entryPage.url());
            if (u.protocol !== "https:" || !sameOrigin(u.toString())) continue;
            const k = u.toString().replace(/#.*$/, "");
            if (seenTargets.has(k)) continue;
            seenTargets.add(k);
            targets.push(k);
          } catch {
            /* skip unparseable */
          }
        }
      }
      // IS THE FRONT DOOR ITSELF THE WALL? The explorer only asks this after a navigation, which is
      // right for it — a nav "Connect Wallet" is not a wall Sage walked into. But a product whose
      // entire app sits behind a sign-in never reaches the explorer at all: it classifies `static`,
      // and the doc hunt used to live inside the explorer, so the one shape that needs docs most
      // could never get them. Asked here, while the entry page is still loaded and settled.
      const entryWall = await wallSignalsOf(entryPage);
      staticWallKind = entryWall ? classifyWallKind(entryWall) : null;
    } catch {
      /* entry capture failed — keep going */
    } finally {
      await entryPage.close().catch(() => {});
    }

    for (let i = 1; i < targets.length; i++) {
      if (Date.now() > deadline) break;
      const target = targets[i];
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const failedRequests: { url: string; status: number }[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
      });
      page.on("response", (r) => {
        const s = r.status();
        if (s >= 400)
          failedRequests.push({ url: r.url().slice(0, 300), status: s });
      });
      try {
        const resp = await page.goto(target, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_MS,
        });
        let rawHtmlTextLen = 0;
        try {
          const body = await resp?.text();
          if (body) rawHtmlTextLen = visibleTextLen(body);
        } catch {
          /* keep 0 */
        }
        await page
          .waitForLoadState("networkidle", { timeout: PAGE_MS })
          .catch(() => {});
        await settleLazyContent(page);
        const title = (await page.title().catch(() => "")).slice(0, 200);
        const h1 = (
          await page
            .locator("h1")
            .first()
            .innerText({ timeout: 1000 })
            .catch(() => "")
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        const ctas = await extractCtas(page);
        const forms = await extractForms(page);
        const renderedTextLen = await page
          .evaluate(() => document.body?.innerText?.length ?? 0)
          .catch(() => 0);
        let screenshot: string | null = null;
        try {
          await fs.mkdir(artifactDir, { recursive: true });
          await page.screenshot({
            path: path.join(artifactDir, `${i}.png`),
            fullPage: true,
          });
          screenshot = `/api/field-tests/${opts.inspectionId}/${i}`;
        } catch {
          screenshot = null;
        }
        captures.push({
          url: page.url(),
          title,
          h1,
          ctas,
          forms,
          consoleErrors,
          failedRequests,
          rawHtmlTextLen,
          renderedTextLen,
          screenshot,
          visibleTextExcerpt: await renderedExcerpt(page),
        });
      } catch {
        /* per-page failure — skip this page, keep the run going */
      } finally {
        await page.close().catch(() => {});
      }
    }

    // The front door was the wall, so read what the product says about the half behind it. Runs after
    // the crawl, when every link the product actually offered is known, and on its own page so a
    // navigation here can never disturb what was already captured.
    let staticDocs: DocPage[] = [];
    if (staticWallKind && Date.now() < deadline) {
      const docPage = await context.newPage();
      try {
        staticDocs = await huntDocs({
          page: docPage,
          startUrl: opts.startUrl,
          wallNote: wallNoteFor(staticWallKind),
          linkedPaths: targets.map((t) => {
            let p = t;
            try {
              const u = new URL(t);
              p = u.pathname + u.search;
            } catch {
              /* keep the raw string */
            }
            return { path: p, label: linkLabels.get(p) ?? "" };
          }),
          walledPaths: (() => {
            try {
              return [new URL(opts.startUrl).pathname];
            } catch {
              return [];
            }
          })(),
          deadline,
          sameOrigin,
        });
      } finally {
        await docPage.close().catch(() => {});
      }
    }

    return buildFieldTestSummary({
      startUrl: opts.startUrl,
      captures,
      durationMs: Date.now() - started,
      limitation:
        turnedAwayLimitation(entryBlocked, sawChallenge) ??
        (captures.length ? null : "Field test found no reachable page."),
      docs: staticDocs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return degrade(`Field test could not run (${msg.slice(0, 80)}).`);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await proxy.close().catch(() => {});
  }
}

/* ───────────────────────── interactive state machine ──────────────────────── */

const START_WORDS = [
  "start",
  "play",
  "enter",
  "begin",
  "continue",
  "skip",
  "next",
  "explore",
];
const CONSENT_WORDS = [
  "accept all",
  "allow all",
  "accept cookies",
  "i agree",
  "accept",
  "agree",
  "got it",
  "dismiss",
  "close",
  "allow",
  "ok",
  "i understand",
  "continue",
];

/** Gather the entry signals (listeners recorded by the init script + a live DOM read). Reads only. */
async function gatherSignals(
  page: Page,
  rawHtmlTextLen: number,
): Promise<ProductSignals> {
  const s = await page
    .evaluate(() => {
      const canvases = Array.from(
        document.querySelectorAll("canvas"),
      ) as HTMLCanvasElement[];
      let canvasArea = 0;
      let webgl = false;
      for (const c of canvases) {
        const area = (c.width || 0) * (c.height || 0);
        if (area > canvasArea) canvasArea = area;
        if (!webgl) {
          try {
            webgl = !!(
              c.getContext("webgl2") ||
              c.getContext("webgl") ||
              c.getContext("experimental-webgl")
            );
          } catch {
            /* ignore */
          }
        }
      }
      const w = window as unknown as {
        __sage?: { keydown?: boolean; gamepad?: boolean; pushState?: number };
      };
      const text = (document.body?.innerText || "").trim();
      return {
        hasCanvas: canvases.length > 0,
        canvasArea,
        webgl,
        keyListeners: !!w.__sage?.keydown,
        gamepad: !!w.__sage?.gamepad,
        spaRouting: (w.__sage?.pushState ?? 0) > 0,
        nodeCount: document.querySelectorAll("*").length,
        renderedTextLen: text.length,
        hasServiceWorker: !!navigator.serviceWorker?.controller,
      };
    })
    .catch(() => null);
  const renderedTextLen = s?.renderedTextLen ?? 0;
  // Self-animation probe — ONLY for a thin shell (a content-rich page is static no matter what it does).
  // Watch the rendered text + node count for a while; if they change with NO interaction from us, this is
  // a live experience (yara.garden's scenes cycle on their own). Early-outs on the first observed change.
  const selfAnimates =
    renderedTextLen < 600
      ? await selfAnimationProbe(page, ANIMATION_PROBE_MS)
      : false;
  return {
    hasCanvas: s?.hasCanvas ?? false,
    canvasArea: s?.canvasArea ?? 0,
    webgl: s?.webgl ?? false,
    keyListeners: s?.keyListeners ?? false,
    gamepad: s?.gamepad ?? false,
    spaRouting: s?.spaRouting ?? false,
    selfAnimates,
    nodeCount: s?.nodeCount ?? 0,
    renderedTextLen,
    rawHtmlTextLen,
    hasServiceWorker: s?.hasServiceWorker ?? false,
  };
}

/**
 * Watch a thin shell for self-animation: snapshot the rendered text + node count, then poll for up to
 * `budgetMs`, returning true the moment the DOM changes on its OWN (we never touch it). Content churn —
 * not length — is the signal (yara's scenes swap without changing the character count). Reads only.
 */
async function selfAnimationProbe(
  page: Page,
  budgetMs: number,
): Promise<boolean> {
  const snap = () =>
    page
      .evaluate(
        () =>
          `${(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400)}|${document.querySelectorAll("*").length}`,
      )
      .catch(() => "");
  const first = await snap();
  if (!first) return false;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_500);
    const now = await snap();
    if (now && now !== first) return true;
  }
  return false;
}

/** A coarse, dependency-free visual fingerprint (text volume + node count + downsampled canvas). */
async function fingerprint(page: Page): Promise<StateFingerprint> {
  const fp = await page
    .evaluate(() => {
      const text = (document.body?.innerText || "").trim();
      let canvasSample: number[] | null = null;
      const canvases = Array.from(
        document.querySelectorAll("canvas"),
      ) as HTMLCanvasElement[];
      let biggest: HTMLCanvasElement | null = null;
      let area = 0;
      for (const c of canvases) {
        const a = (c.width || 0) * (c.height || 0);
        if (a > area) {
          area = a;
          biggest = c;
        }
      }
      if (biggest) {
        try {
          const small = document.createElement("canvas");
          small.width = 24;
          small.height = 24;
          const ctx = small.getContext("2d");
          if (ctx) {
            ctx.drawImage(biggest, 0, 0, 24, 24);
            const data = ctx.getImageData(0, 0, 24, 24).data;
            const out: number[] = [];
            for (let i = 0; i < data.length; i += 16) out.push(data[i]); // sample R channel
            // if every sample is identical (e.g. a blank WebGL buffer), treat as no signal.
            if (out.some((v) => v !== out[0])) canvasSample = out;
          }
        } catch {
          /* tainted / blank — no canvas signal */
        }
      }
      return {
        textLen: text.length,
        nodeCount: document.querySelectorAll("*").length,
        canvasSample,
      };
    })
    .catch(() => ({
      textLen: 0,
      nodeCount: 0,
      canvasSample: null as number[] | null,
    }));
  return fp;
}

/**
 * Rendered DOM visible-text excerpt (NOT raw HTML), capped. Line structure is PRESERVED (only spaces/tabs
 * within a line are collapsed, newlines are kept) — innerText puts each block element (a menu item, a
 * panel row, a list entry) on its own line, and the corpus distiller splits on newlines. Collapsing every
 * whitespace to one space (the old behavior) fused a whole context menu / properties panel into a single
 * 40-word blob that no tester could paraphrase-match; keeping the lines turns it into discrete, matchable
 * firsthand observations ("Select all", "Toggle grid", "Zen mode"). Capped a little higher to fit the lines.
 */
async function renderedExcerpt(page: Page): Promise<string> {
  // 4000, not 900. `innerText` already contains the WHOLE rendered document — the old 900-char slice
  // cut everything below the first screen. Measured on clawup.org: the pricing section ("Buy token
  // credits", "$20 per agent / month") sits ~3k chars in, so the corpus knew "pricing" existed but
  // not what it said — and every consumer downstream (anchor corpus, mission architect, the pinned
  // judging key) was starved of exactly the doorway text the founder's goal named.
  return (
    await page
      .evaluate(() =>
        (document.body?.innerText || "")
          .replace(/[^\S\n]+/g, " ") // collapse spaces/tabs but KEEP newlines
          .replace(/\n{2,}/g, "\n") // squeeze blank lines
          .trim(),
      )
      .catch(() => "")
  ).slice(0, 4000);
}

/**
 * Reveal lazy-loaded content before reading a PAGE: scroll to the bottom, give below-the-fold
 * sections a beat to load, scroll back. Page captures only — never interactive state captures,
 * where a scroll would mutate the very state being recorded. Failure is silently ignored: the
 * page is then read exactly as before.
 */
async function settleLazyContent(page: Page): Promise<void> {
  try {
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight ?? 0));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
  } catch {
    /* reveal is best-effort — the unscrolled page still reads fine */
  }
}

/** A few notable rendered elements (headings, buttons, inputs) — tag/text/role only. Reads only. */
async function notableElements(
  page: Page,
): Promise<{ tag: string; text: string; role: string }[]> {
  return page
    .evaluate(() => {
      const out: { tag: string; text: string; role: string }[] = [];
      const nodes = Array.from(
        document.querySelectorAll(
          "h1,h2,h3,button,[role=button],a[href],input,label",
        ),
      );
      for (const el of nodes) {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const text = (
          he.innerText ||
          he.getAttribute("aria-label") ||
          (he as HTMLInputElement).placeholder ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        if (!text) continue;
        out.push({
          tag: he.tagName.toLowerCase(),
          text,
          role: he.getAttribute("role") || "",
        });
        if (out.length >= 12) break;
      }
      return out;
    })
    .catch(() => []);
}

/**
 * Mint the current state's interactive elements, tagging each with a stable `data-sage-eid` so the
 * controller can reference it by id and `executeAction` can target it. Non-sensitive text inputs /
 * textareas / contenteditable are marked `typable`; form-submit controls are excluded (Sage never
 * submits forms). The typable/sensitive decision is made in Node via {@link isSensitiveField}.
 */
async function mintInteractiveElements(page: Page): Promise<MintedElement[]> {
  const raw = await page
    .evaluate(() => {
      document
        .querySelectorAll("[data-sage-eid]")
        .forEach((e) => e.removeAttribute("data-sage-eid"));
      const sel =
        "button,[role=button],a[href],[role=link],input,textarea,select,[contenteditable=''],[contenteditable=true],[tabindex],[onclick],[class*='btn' i],[class*='button' i]";
      const set = new Set<Element>(Array.from(document.querySelectorAll(sel)));
      // ALSO include controls that only a real user can spot — immersive onboarding uses styled <div>s
      // ("tap to step inside", "come in") and clickable WORD LABELS ("Yara's Grove", "Yara") made
      // interactive via a JS click listener, not a <button> or cursor:pointer. So mint: (a) any
      // pointer-cursor leaf-ish control (icon buttons, "·"/"🔊"), and (b) any LEAF element whose short
      // text carries real words (a nameable affordance the goal-directed layer can target by id). Emoji-
      // only leaves are minted only when they carry a pointer cursor, so decoration never floods the list.
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const he = el as HTMLElement;
        const t = (he.innerText || "").trim();
        if (!t || t.length > 40) continue;
        const words = (t.match(/[a-zA-ZÀ-ɏ]{2,}/g) || []).length;
        try {
          const pointer = getComputedStyle(he).cursor === "pointer";
          if (
            (pointer && he.childElementCount <= 1) ||
            (he.childElementCount === 0 && words >= 1)
          )
            set.add(el);
        } catch {
          /* ignore */
        }
      }
      const nodes = Array.from(set);
      const out: Array<{
        id: string;
        label: string;
        role: string;
        tag: string;
        inputType: string;
        name: string;
        elId: string;
        placeholder: string;
        autocomplete: string;
        ariaLabel: string;
        editable: boolean;
        href: string | null;
        options: string[] | null;
      }> = [];
      let n = 0;
      for (const el of nodes) {
        if (n >= 50) break;
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width < 4 || rect.height < 4) continue;
        const st = getComputedStyle(he);
        if (
          st.visibility === "hidden" ||
          st.display === "none" ||
          Number(st.opacity) === 0
        )
          continue;
        const tag = he.tagName.toLowerCase();
        const type = (he.getAttribute("type") || "").toLowerCase();
        const inForm = !!he.closest("form");
        // never a form-submit control (Sage does not submit forms)
        if (
          inForm &&
          ((tag === "button" && (type === "submit" || type === "")) ||
            (tag === "input" && type === "submit"))
        )
          continue;
        const label = (
          he.getAttribute("aria-label") ||
          he.innerText ||
          (he as HTMLInputElement).placeholder ||
          (he as HTMLInputElement).value ||
          he.getAttribute("title") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
        const id = "e" + n;
        he.setAttribute("data-sage-eid", id);
        // SAME-SITE link destination (path only) — the element's own href IS a navigation the click
        // intends. On a React SPA a re-render can strip the minted attribute between mint and click,
        // so the executor needs a truthful fallback: go where the link was going.
        let href: string | null = null;
        if (tag === "a") {
          try {
            const a = he as HTMLAnchorElement;
            const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
            if (a.host && strip(a.host) === strip(location.host)) {
              const p = a.pathname + a.search;
              if (p && p.length <= 120) href = p;
            }
          } catch {
            /* no href */
          }
        }
        out.push({
          id,
          label,
          role: he.getAttribute("role") || "",
          tag,
          inputType: type || (tag === "input" ? "text" : ""),
          name: he.getAttribute("name") || "",
          elId: he.id || "",
          placeholder: he.getAttribute("placeholder") || "",
          autocomplete: he.getAttribute("autocomplete") || "",
          ariaLabel: he.getAttribute("aria-label") || "",
          editable: he.isContentEditable === true,
          href,
          options:
            tag === "select"
              ? Array.from((he as HTMLSelectElement).options)
                  .map((o) => o.value)
                  .filter(Boolean)
                  .slice(0, 20)
              : null,
        });
        n++;
      }
      return out;
    })
    .catch(
      () =>
        [] as Array<{
          id: string;
          label: string;
          role: string;
          tag: string;
          inputType: string;
          name: string;
          elId: string;
          placeholder: string;
          autocomplete: string;
          ariaLabel: string;
          editable: boolean;
          href: string | null;
          options: string[] | null;
        }>,
    );
  return raw.map((r) => {
    // `url` and `number` join the typable types so Sage can fill the two things a real form asks for
    // most and it previously could not: a link box and a quantity box. Neither widens what may be
    // TYPED — `isSensitiveField` still refuses every credential, payment and personal-data field, and
    // a bare number box with no quantity wording stays refused because it could be a card.
    const isTextInput =
      (r.tag === "input" &&
        ["text", "search", "url", "number", ""].includes(r.inputType)) ||
      r.tag === "textarea" ||
      r.editable;
    const descriptor = {
      type: r.inputType,
      name: r.name,
      id: r.elId,
      placeholder: r.placeholder,
      autocomplete: r.autocomplete,
      ariaLabel: r.ariaLabel,
      // The VISIBLE label counts too: a field whose only clue is the word on screen ("Card number")
      // was invisible to a check that read attributes alone.
      label: r.label,
    };
    const typable = isTextInput && !isSensitiveField(descriptor);
    const el: MintedElement = {
      id: r.id,
      label: r.label,
      role: r.role,
      tag: r.tag,
      typable,
    };
    // The FIELD decides what it is asking for — the model only ever points at it.
    if (typable) el.valueKind = classifyFieldValue({ ...descriptor, tag: r.tag });
    if (r.options && r.options.length) el.options = r.options;
    if (r.href) el.href = r.href;
    return el;
  });
}

/** The STRUCTURED kind of a controller action — what the journey evaluator reasons over (never English). */
function actionKindOf(action: ControllerAction): FieldTestState["actionKind"] {
  switch (action.kind) {
    case "click_element":
    case "click_coords":
    // opening a discovered path IS the programmatic click of that link — labeling it "wait" (the old
    // default fallthrough) under-credited navigation checkpoints for pages Sage genuinely reached.
    case "open_path":
      return "click";
    case "press_key":
      return "key";
    case "type_text":
      return "type";
    case "select_option":
      return "click";
    case "scroll":
      return "scroll";
    case "drag":
      return "drag";
    case "go_back":
      return "back";
    default:
      return "wait";
  }
}

/** A small JPEG of the current viewport as a data URI, for the multimodal controller. Null on failure. */
async function screenshotJpegDataUri(page: Page): Promise<string | null> {
  try {
    const buf = await page.screenshot({
      type: "jpeg",
      quality: 50,
      timeout: 6_000,
    });
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The largest canvas' geometry as viewport percentages (for a visually-driven world), or null. */
async function canvasGeomPct(
  page: Page,
): Promise<{ xPct: number; yPct: number; wPct: number; hPct: number } | null> {
  return page
    .evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const vw = window.innerWidth || 1,
        vh = window.innerHeight || 1;
      if (r.width < 40 || r.height < 40) return null;
      return {
        xPct: Math.round((r.x / vw) * 100),
        yPct: Math.round((r.y / vh) * 100),
        wPct: Math.round((r.width / vw) * 100),
        hPct: Math.round((r.height / vh) * 100),
      };
    })
    .catch(() => null);
}

/**
 * How many visible fields on this screen now hold a value. The capture trigger is evidence a tester
 * and the mission brain both read, so it must count what the PAGE ended up with — not how many fill
 * attempts were made, which counts a framework-rejected fill as a success and misses every field the
 * required-field pass completed afterwards.
 */
async function filledFieldCount(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      let n = 0;
      for (const el of Array.from(
        document.querySelectorAll("input,textarea,select"),
      )) {
        const he = el as HTMLInputElement;
        const t = (he.getAttribute("type") || "").toLowerCase();
        if (t === "hidden" || t === "submit" || t === "button") continue;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width < 4 || rect.height < 4) continue;
        if ((he.value ?? "").trim().length > 0) n++;
      }
      return n;
    })
    .catch(() => 0);
}

/**
 * Is there anything on this screen Sage could still fill in? The question a wizard turns on: a step
 * with an empty field must be completed before the "Continue →" next to it is worth pressing.
 *
 * A SEARCH box is NOT a wizard step. Nearly every product carries a global search field in its nav,
 * and counting it here made the explorer treat any homepage as "a form to complete" — it typed the
 * synthetic term into site search and submitted, burning its opening states on a dropdown instead of
 * going where the goal pointed (measured: commonstack.ai — goal named the playground; Sage searched
 * "test" and got "No options"). Search fields count only when the founder's goal IS about searching.
 */
async function hasEmptySafeField(page: Page, allowSearch = false): Promise<boolean> {
  return (await pendingRequiredFields(page)).some(
    (f) => !isSensitiveField(f) && (allowSearch || classifyFieldValue(f) !== "search"),
  );
}

/** One still-empty required field, as read from the live page. */
interface PendingRequired {
  eid: string;
  /** whether the APP itself insists on this field — decides if an unfillable one blocks the submit. */
  required: boolean;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  ariaLabel: string;
  label: string;
  tag: string;
}

/**
 * Read every still-empty visible field, and tag each so it can be filled by id.
 *
 * Deliberately NOT limited to fields carrying `required`. A React form validates in JavaScript and
 * frequently sets no such attribute — Sage's own launch form is exactly that, and its "target users"
 * field was invisible to an attribute-driven pass, so every submission bounced off "Target users is
 * required." while Sage believed it had filled the form. `requiredOnly` marks which of them the app
 * itself insists on, which is what decides whether an unfillable field BLOCKS the submission.
 */
async function pendingRequiredFields(page: Page): Promise<PendingRequired[]> {
  return page
    .evaluate(() => {
      const out: PendingRequired[] = [];
      let n = 0;
      for (const el of Array.from(
        document.querySelectorAll("input,textarea,select"),
      )) {
        const he = el as HTMLInputElement;
        const required =
          he.required || he.getAttribute("aria-required") === "true";
        const t = (he.getAttribute("type") || "").toLowerCase();
        if (["hidden", "submit", "button", "checkbox", "radio", "file"].includes(t))
          continue;
        if (he.disabled || he.readOnly) continue;
        if ((he.value ?? "").trim().length > 0) continue;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width < 4 || rect.height < 4) continue;
        const eid = "req" + n++;
        he.setAttribute("data-sage-req", eid);
        out.push({
          eid,
          required,
          type: (he.getAttribute("type") || "").toLowerCase(),
          name: he.getAttribute("name") || "",
          id: he.id || "",
          placeholder: he.getAttribute("placeholder") || "",
          autocomplete: he.getAttribute("autocomplete") || "",
          ariaLabel: he.getAttribute("aria-label") || "",
          label: (
            he.labels?.[0]?.textContent ||
            he.getAttribute("aria-label") ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim(),
          tag: he.tagName.toLowerCase(),
        });
      }
      return out;
    })
    .catch(() => [] as PendingRequired[]);
}

/**
 * Finish what the mint could not see, then say whether the form can honestly be submitted.
 *
 * Minting only ever sees the controls it recognises, and a required field it missed is invisible to
 * the fill pass — so Sage would fill what it found, submit, and collect a validation error instead of
 * a result. That is exactly what happened on Sage's own launch form: two of three fields filled, and
 * the only thing the submission ever produced was "target users is required". A failed submission is
 * worse than none, because it also poisons the corpus: the state Sage records as the outcome contains
 * an error message rather than the screen a real tester would describe.
 *
 * So every still-empty REQUIRED field is read straight from the page and filled with what it asks
 * for. Returns true only when something REQUIRED remains that Sage must not type — a signup form's
 * email or password — in which case the form is left honestly incomplete rather than submitted.
 */
export async function requiredSensitiveFieldPending(
  page: Page,
): Promise<boolean> {
  let blocked = false;
  for (const f of await pendingRequiredFields(page)) {
    if (isSensitiveField(f)) {
      // Only a field the APP insists on can block. An optional credential box is simply left alone.
      if (f.required) blocked = true;
      continue;
    }
    const value = resolveSyntheticValue(classifyFieldValue(f));
    const loc = page.locator(`[data-sage-req="${f.eid}"]`).first();
    if (f.tag === "select") {
      await loc.selectOption({ index: 1 }, { timeout: 2_000 }).catch(() => {});
      continue;
    }
    await loc.fill(value, { timeout: 2_000 }).catch(async () => {
      await loc.click({ force: true }).catch(() => {});
      await page.keyboard.type(value, { delay: 10 }).catch(() => {});
    });
  }
  if (blocked) return true;
  // Anything the APP requires that is still empty after that pass blocks an honest submission.
  return (await pendingRequiredFields(page)).some((f) => f.required);
}

/**
 * Find the form's own submit control and mark it for clicking, or refuse. Returns its label, `null`
 * when there is none (Enter is then the honest fallback), or `"unsafe"` when the only way forward
 * would spend money or destroy something.
 *
 * Submit controls are deliberately NOT minted as ordinary elements — that exclusion is what kept the
 * exploring model from pressing random submit buttons, and it stays. This is the one narrow path that
 * may press one, after Sage has actually filled the form it belongs to.
 */
const UNSAFE_SUBMIT =
  /\b(delete|remove|destroy|erase|wipe|deactivate|close account|pay|payment|purchase|buy|checkout|check out|order|subscribe|upgrade|donate|withdraw|transfer|send money|top ?up|billing)\b/i;
export async function findSubmitControl(
  page: Page,
): Promise<string | null | "unsafe"> {
  const found = await page
    .evaluate(() => {
      document
        .querySelectorAll("[data-sage-submit]")
        .forEach((e) => e.removeAttribute("data-sage-submit"));
      // FORM-SCOPED ONLY. With no <form> element — a React wizard built from divs, say — scanning the
      // whole document for "a button that looks like submit" reaches page navigation and headers, and
      // pressing one of those leaves the flow entirely. There is a safe path for that case already:
      // fill the fields, return, and let the deterministic forward affordance press "Continue →" on
      // the next turn, now that the step is actually complete.
      const forms = Array.from(document.querySelectorAll("form"));
      if (!forms.length) return null;
      for (const scope of forms) {
        const cands = Array.from(
          scope.querySelectorAll(
            "button[type=submit],input[type=submit],button:not([type=button]):not([type=reset]),[role=button]",
          ),
        );
        for (const c of cands) {
          const he = c as HTMLElement;
          if ((he as HTMLButtonElement).disabled) continue;
          const rect = he.getBoundingClientRect?.();
          if (!rect || rect.width < 4 || rect.height < 4) continue;
          const st = getComputedStyle(he);
          if (st.visibility === "hidden" || st.display === "none") continue;
          const label = (
            he.getAttribute("aria-label") ||
            he.innerText ||
            (he as HTMLInputElement).value ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60);
          he.setAttribute("data-sage-submit", "1");
          return label;
        }
      }
      return null;
    })
    .catch(() => null);
  if (found === null) return null;
  return UNSAFE_SUBMIT.test(found) ? "unsafe" : found;
}

/**
 * Execute ONE validated controller action in the guarded browser and return an honest trigger label.
 * Every action is bounded and read-only-ish: it clicks a Sage-minted element / normalized coordinate,
 * presses an allowlisted key, types a SYNTHETIC value into a re-verified non-sensitive field, selects a
 * presented option, scrolls, drags, waits, or goes back. It never authors a selector/URL/JS, never
 * submits a form, and never types a credential or personal datum. Failure-isolated (returns a label).
 */
/** Slow-channel click timeouts seen on this page — after two, stop paying the tax on every click. */
const slowChannelTimeouts = new WeakMap<Page, number>();

/**
 * CLICK THROUGH WHICHEVER CHANNEL THE PAGE CAN ACTUALLY ANSWER.
 *
 * Playwright's own `click` needs a renderer round-trip for its actionability and hit-test work. On a
 * CPU-starved box — the 2-core VM, a WebGL/3D product, an animated canvas — that round-trip blows any
 * sane timeout while the page is perfectly clickable by hand. MEASURED on useagora.vercel.app/square,
 * on the VM: 0/4 via `locator.click` (every attempt hit the 2.5s wall dead-on), 4/4 once we fall
 * through. It cost that inspection its whole plan — Sage never got past the splash gate, so the
 * mission brain only ever saw a landing page and wrote a mission about reading the headline.
 *
 * `page.evaluate` stays responsive throughout, because it runs in the JS context rather than waiting
 * on the renderer. So read the geometry THERE and click the point with a real mouse.
 *
 * Order matters: a trusted mouse event first (canvas/WebGL products listen for real pointer events and
 * ignore synthetic ones), a synthetic dispatch only as the last resort. Returns whether a click was
 * actually DELIVERED — "no effect" must mean the page ignored a real click, never that we failed to
 * land one, because the caller retires an affordance that produced no effect.
 */
async function clickThroughAnyChannel(page: Page, id: string): Promise<boolean> {
  const sel = `[data-sage-eid="${id}"]`; // ids are minted "e0","e1",… — nothing to escape
  if ((slowChannelTimeouts.get(page) ?? 0) < 2) {
    try {
      await page.locator(sel).first().click({ timeout: 2_500, force: true });
      return true;
    } catch {
      slowChannelTimeouts.set(page, (slowChannelTimeouts.get(page) ?? 0) + 1);
    }
  }
  // A REAL mouse click at the element's own centre, with the geometry read over the fast channel.
  try {
    const at = await page.evaluate((eid: string) => {
      const el = document.querySelector(`[data-sage-eid="${eid}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: window.innerWidth,
        h: window.innerHeight,
      };
    }, id);
    // Only click a point that is genuinely on screen — off-viewport coordinates would land on
    // whatever happens to sit at that spot, which is a fabricated interaction, not this one.
    if (at && at.x >= 0 && at.y >= 0 && at.x <= at.w && at.y <= at.h) {
      await page.mouse.click(at.x, at.y);
      return true;
    }
  } catch {
    /* fall through to the synthetic dispatch */
  }
  try {
    return await page.evaluate((eid: string) => {
      const el = document.querySelector(`[data-sage-eid="${eid}"]`);
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    }, id);
  } catch {
    return false;
  }
}

/**
 * The outcome of one attempted action, with the two things kept SEPARATE on purpose.
 *
 * `trigger` is the human sentence for the filmstrip. `delivered` says whether Sage actually landed the
 * action on the page. They must not be conflated: on 8 Aug a click that timed out and a click that
 * landed on an inert button both produced the string "attempted click_element (no effect)", so the
 * loop-preventer retired the ONE working door on Agora and the plan collapsed to a headline-reading
 * mission. An executor's own failure is a fact about SAGE, never a fact about the product, and only
 * facts about the product may become evidence (see buildObservationCorpus).
 */
export interface ActionOutcome {
  trigger: string;
  /** false ONLY when the action never reached the page — not when the page ignored it. */
  delivered: boolean;
}

async function executeAction(
  page: Page,
  action: ControllerAction,
  elements: MintedElement[],
): Promise<ActionOutcome> {
  let delivered = true;
  const trigger = await dispatchAction(page, action, elements, () => {
    delivered = false;
  });
  return { trigger, delivered };
}

async function dispatchAction(
  page: Page,
  action: ControllerAction,
  elements: MintedElement[],
  /** call when the action could NOT be landed on the page at all. */
  markUndelivered: () => void,
): Promise<string> {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const loc = (id: string) => page.locator(`[data-sage-eid="${id}"]`).first();
  const labelOf = (id: string) =>
    (elements.find((e) => e.id === id)?.label ?? id).slice(0, 40);
  try {
    switch (action.kind) {
      case "click_element": {
        if (await clickThroughAnyChannel(page, action.elementId))
          return `clicked "${labelOf(action.elementId)}"`;
        {
          // RESILIENT TARGETING (the SPA gap): a React re-render strips the minted data-sage-eid
          // between mint and click, and an open dropdown/overlay can swallow a hit — the trace then
          // reads "attempted click (no effect)" forever (measured: commonstack.ai, 3 dead clicks on
          // header links that existed and worked). Recover in order:
          //   1. re-resolve the SAME control by its minted label (role/text — survives re-renders);
          //   2. a same-site LINK falls back to going where it was going anyway (its Sage-read href).
          const el = elements.find((e) => e.id === action.elementId);
          const label = (el?.label ?? "").trim();
          if (label && label.length <= 80) {
            const byLabel = page
              .locator(`a, button, [role=button], [role=link]`, { hasText: label })
              .first();
            const retried = await byLabel
              .click({ timeout: 2_000, force: true })
              .then(() => true)
              // the same starved-renderer story as above: dispatch in-page rather than give up
              .catch(() =>
                byLabel
                  .evaluate((node) => {
                    (node as HTMLElement).click();
                    return true;
                  })
                  .catch(() => false),
              );
            if (retried) return `clicked "${labelOf(action.elementId)}"`;
          }
          if (el?.href) {
            try {
              const target = new URL(el.href, page.url());
              await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
              await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
              return `opened ${el.href} (following the "${label.slice(0, 32)}" link)`;
            } catch {
              /* fall through to the honest no-effect label */
            }
          }
          // Every channel refused. Say what is TRUE — Sage could not reach this control — rather than
          // "no effect", which reads as a finding about the product and is how the Agora plan died.
          markUndelivered();
          return `could not reach "${labelOf(action.elementId)}"`;
        }
      }
      case "open_path": {
        // Same-origin only, and only a path Sage discovered and offered — `coerceDecision` already
        // refused anything else, and the egress boundary refuses anything off-host regardless.
        const target = new URL(action.path, page.url());
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
        await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
        return `opened ${action.path}`;
      }
      case "click_coords":
        await page.mouse.click(
          (action.xPct / 100) * vp.width,
          (action.yPct / 100) * vp.height,
        );
        return `clicked at ${Math.round(action.xPct)}%,${Math.round(action.yPct)}%`;
      case "press_key":
        if (
          action.key !== "Enter" &&
          action.key !== "Tab" &&
          action.key !== "Escape" &&
          (await textInputFocused(page))
        )
          return `skipped ${action.key} (text input focused)`;
        {
          // a BOUNDED movement burst — one action, up to 5 presses, then the caller recaptures.
          const n = Math.max(1, Math.min(5, action.repeat ?? 1));
          for (let i = 0; i < n; i++) {
            await page.keyboard.press(action.key);
            if (n > 1) await page.waitForTimeout(160);
          }
          return n > 1
            ? `pressed ${action.key} ×${n}`
            : `pressed ${action.key}`;
        }
      case "type_text": {
        // The FIELD's own classification wins over the model's choice — the model may point at an
        // input, but what that input is asking for is read off the input itself.
        const kind =
          elements.find((e) => e.id === action.elementId)?.valueKind ??
          action.valueKind;
        const value = resolveSyntheticValue(kind);
        const el = loc(action.elementId);
        // LIVE re-check — the DOM may have changed since minting, so the field is re-read and judged
        // again before a single character is typed. It reads the descriptor in the page and decides in
        // NODE, against the same `isSensitiveField` the mint used. It used to re-implement the rules as
        // a second inline regex, and that copy is precisely where a guard silently rots out of step
        // with the real one — the `account\b` boundary bug lived in both copies at once.
        const live = await el
          .evaluate((node) => {
            const he = node as HTMLElement;
            return {
              type: (he.getAttribute("type") || "").toLowerCase(),
              name: he.getAttribute("name") || "",
              id: he.id || "",
              placeholder: he.getAttribute("placeholder") || "",
              autocomplete: he.getAttribute("autocomplete") || "",
              ariaLabel: he.getAttribute("aria-label") || "",
              label: (he.getAttribute("aria-label") || he.innerText || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 120),
            };
          })
          .catch(() => null);
        if (!live || isSensitiveField(live))
          return "skipped typing (sensitive field)";
        await el.fill(value, { timeout: 2_500 }).catch(async () => {
          await el.click({ force: true }).catch(() => {});
          await page.keyboard.type(value, { delay: 10 }).catch(() => {});
        });
        // VERIFY the value actually landed (a framework-controlled input can silently reject a fill).
        // The trigger must never claim an entry that did not happen — and the caller uses it as progress.
        const landed = await el
          .evaluate((node, v) => {
            const he = node as HTMLElement & { value?: string };
            const got =
              typeof he.value === "string" ? he.value : (he.textContent ?? "");
            return (
              got.trim().length > 0 &&
              v.slice(0, 12).includes(got.trim().slice(0, 12).slice(0, 12))
            );
          }, value)
          .catch(() => false);
        if (!landed) return "attempted to type (the field did not accept it)";
        // The trigger is evidence a tester will read — it names the value that actually landed.
        return typedTrigger(kind);
      }
      case "select_option":
        await loc(action.elementId).selectOption(action.optionValue, {
          timeout: 2_500,
        });
        return `selected "${action.optionValue.slice(0, 40)}"`;
      case "scroll":
        await page.evaluate(
          (dir) =>
            window.scrollBy(
              0,
              dir === "up" ? -window.innerHeight : window.innerHeight,
            ),
          action.direction,
        );
        return `scrolled ${action.direction}`;
      case "drag":
        await page.mouse.move(
          (action.fromXPct / 100) * vp.width,
          (action.fromYPct / 100) * vp.height,
        );
        await page.mouse.down();
        await page.mouse.move(
          (action.toXPct / 100) * vp.width,
          (action.toYPct / 100) * vp.height,
          { steps: 8 },
        );
        await page.mouse.up();
        return "dragged across the surface";
      case "wait":
        await page.waitForTimeout(1_200);
        return "waited";
      case "go_back":
        await page.goBack({ timeout: 4_000 }).catch(() => {});
        return "went back";
      case "stop":
        return `stopped (${action.status})`;
    }
  } catch {
    markUndelivered();
    return `could not carry out ${action.kind}`;
  }
}

/**
 * A WAF/bot-challenge interstitial ("Just a moment…", "Checking your browser", "Verify you are
 * human") — thin text + challenge phrasing. These usually clear on their own once the challenge JS
 * runs; the caller waits briefly and reloads ONCE, so a protected-but-public product yields its real
 * pages instead of a challenge screen masquerading as the product. Read-only.
 */
async function looksLikeChallenge(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const title = (document.title || "").toLowerCase();
      const text = (document.body?.innerText || "").toLowerCase();
      const re =
        /just a moment|checking your browser|verify (that )?you are (a )?human|verifying you are human|attention required|access denied|enable javascript and cookies|ddos protection|are you a robot|cf-browser-verification|security check to access/;
      return text.length < 900 && (re.test(title) || re.test(text));
    })
    .catch(() => false);
}

/** Whether the page is showing a loading state right now (spinner/progress, "loading" text, bare canvas). */
async function isLoading(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const hasSpinner = !!document.querySelector(
        '[class*="spinner" i], [class*="loading" i], [class*="loader" i], progress, [role="progressbar"]',
      );
      const text = (document.body?.innerText || "").trim().toLowerCase();
      const loadingText =
        /\b(loading|please wait|entering|initializing)\b/.test(text) &&
        text.length < 200;
      const canvas = document.querySelector(
        "canvas",
      ) as HTMLCanvasElement | null;
      const canvasVisible =
        !!canvas && (canvas.getBoundingClientRect?.().width ?? 0) > 0;
      const bareCanvas = canvasVisible && text.length < 40;
      return hasSpinner || loadingText || bareCanvas;
    })
    .catch(() => false);
}

/**
 * Run the interactive state machine on an already-loaded entry page: wait out loading, then a
 * safe, capped interaction ladder — capturing a real state after each meaningful action. Never
 * types data, never submits forms, stays same-origin. Failure-isolated.
 */
async function exploreInteractive(ctx: {
  page: Page;
  startUrl: string;
  inspectionId: string;
  artifactDir: string;
  host: string;
  started: number;
  signals: ProductSignals;
  entryErrors: string[];
  /** shared buffer the request interceptor fills with egress methods; capture() drains it per state. */
  methodsSinceCapture: string[];
  /** the founder's exact goal — drives the goal-directed controller when present. */
  goal?: string;
  /** the founder's compiled ordered journey (checkpoint-driven targeting). */
  journey?: GoalJourneyV1 | null;
  /** The founder's TEST account (optional). Used ONLY on a password wall; the values are never
   *  logged, never captured into a state, and never reach a prompt. */
  testAccount?: { email: string; password: string; mailbox?: MailboxAccess | null } | null;
  /** same-host pages the static crawl discovered — the only routes `open_path` may take. */
  candidatePaths?: readonly string[];
  /** OUT: every same-site path the explorer discovered in the live DOM — the caller feeds these to
   *  the url-evidence crawl, so a client-rendered product (whose static link list was empty) still
   *  gets readable pages, url-verifiable missions, and a richer corpus. */
  discoveredPathsOut?: string[];
  /** controller deps (scripted decider for fixtures; real multimodal model otherwise). */
  controllerDeps?: DecideDeps;
}): Promise<FieldTestSummary> {
  const { page, inspectionId, artifactDir, host, methodsSinceCapture } = ctx;
  const deadline = ctx.started + EXPLORE_MS;
  const states: FieldTestState[] = [];
  let prevFp: StateFingerprint | null = null;
  // the last pathname the TRAIL narrated — decoration state only, never part of any captured state.
  let lastTrailPath = "";
  /** AUTHENTICATED EXPLORATION state: whether the founder's test account got us in, when that
   *  happened (states at/after this index are authenticated → redacted), and a hard attempt cap so a
   *  wrong credential can never become a login-retry loop against the founder's product. */
  let loggedIn = false;
  let loginAttempts = 0;
  let authFrom = Number.POSITIVE_INFINITY;
  let shotIdx = 0;
  /** The wall that turned Sage away, if any — the trigger for the doc hunt after exploration ends. */
  let wallNote: string | null = null;
  /** Same-host paths the product LINKED, with their link text, harvested live. Raw material for
   *  {@link docCandidates}; kept out here so it survives the exploration closure. */
  const linkedPaths: { path: string; label: string }[] = [];
  /** Doc-labeled links harvested ANYWHERE during exploration, absolute, including off-host links on
   *  the same registrable domain — "Product Docs" almost always points at docs.<domain>, and the
   *  same-host harvest silently dropped exactly the link that answers "what is behind the wall?".
   *  Measured on clawup.org: /terms showed a CTA literally labelled "Product Docs" and docs read 0. */
  const docLinkUrls = new Map<string, string>();
  /** Did the founder's compiled journey end with unobserved checkpoints? Defaults to "yes" whenever
   *  a journey exists at all, and the goal-directed runner refines it — if that runner never runs,
   *  nothing was observed, which IS a gap. */
  let journeyHadGap = (ctx.journey?.checkpoints?.length ?? 0) > 0;
  /** Routes Sage was turned away from — never offer them back to the doc hunt. */
  const walledPaths: string[] = [];

  const sameOrigin = (u: string): boolean => {
    try {
      return sameSiteHost(new URL(u).host, host);
    } catch {
      return false;
    }
  };

  const capture = async (
    trigger: string,
    action?: {
      kind: FieldTestState["actionKind"];
      label?: string;
      /** pass the executor's own verdict through — see FieldTestState.delivered. */
      delivered?: boolean;
    },
  ): Promise<number> => {
    const fp = await fingerprint(page);
    const delta = fingerprintDelta(prevFp, fp);
    prevFp = fp;
    let screenshot: string | null = null;
    try {
      await fs.mkdir(artifactDir, { recursive: true });
      await page.screenshot({
        path: path.join(artifactDir, `${shotIdx}.png`),
        timeout: 8_000,
      });
      screenshot = `/api/field-tests/${inspectionId}/${shotIdx}`;
      shotIdx++;
    } catch {
      screenshot = null;
    }
    // LIVE TRAIL — publish the step the moment it exists, so the founder watching the inspecting
    // page sees the work rather than a still spinner. Best-effort; never affects the run.
    //
    // The trail label narrates CONSEQUENCE, not just the act: "clicked X → /signup" reads as an
    // agent using the product; "clicked X" alone read as pages flipping (the founder's own words).
    // Decoration is TRAIL-ONLY — state.trigger is corpus and stays byte-identical.
    let trailLabel = trigger;
    try {
      const path = new URL(page.url()).pathname;
      if (path !== lastTrailPath && /^(clicked|explored|typed|chose|drew|sent)/i.test(trigger)) {
        trailLabel = `${trigger} → ${path}`;
      } else if (delta >= 18 && /^(clicked|explored|typed|chose|drew|sent)/i.test(trigger)) {
        trailLabel = `${trigger} — the screen changed`;
      }
      lastTrailPath = path;
    } catch {
      /* decoration only */
    }
    void recordFieldTestStep(inspectionId, {
      label: trailLabel,
      screenshot,
      url: page.url(),
    });
    /**
     * REDACT EVERYTHING SEEN WHILE AUTHENTICATED. Anchors are published verbatim on the plan page
     * and to testers, and anchors come from these strings — so a logged-in dashboard showing an API
     * key or the founder's email would otherwise leak into public mission copy. Applied at the one
     * place every state is born, so no authenticated path can bypass it. Logged-out states are
     * untouched (byte-identical to before).
     */
    const authed = states.length >= authFrom;
    const scrub = (t: string) => (authed ? redactSecrets(t, ctx.testAccount ?? undefined) : t);
    const excerpt = scrub(await renderedExcerpt(page));
    const els = (await notableElements(page)).map((e) =>
      authed ? { ...e, text: scrub(e.text ?? "") } : e,
    );
    states.push({
      trigger,
      screenshot,
      visibleTextExcerpt: excerpt,
      notableElements: els,
      pixelDeltaPct: delta,
      url: page.url(),
      networkMethods: methodsSinceCapture.splice(0), // the methods observed since the previous capture
      // the STRUCTURED action that produced this state (minted here, never parsed from English) — the
      // goal-journey evaluator reasons over these, so "sent" can never be mistaken for "received".
      ...(action?.kind ? { actionKind: action.kind } : {}),
      ...(action?.label ? { actedLabel: action.label.slice(0, 80) } : {}),
      ...(action?.delivered === false ? { delivered: false } : {}),
    });
    return delta;
  };

  try {
    // 1. initial state (loading or not — the honest starting point).
    await capture("initial load", { kind: "load" });

    // 2. loading patience — poll until the state settles or the budget runs out.
    if (await isLoading(page)) {
      const loadDeadline = Math.min(deadline, Date.now() + LOADING_BUDGET_MS);
      let stableRuns = 0;
      let last: StateFingerprint | null = prevFp;
      while (Date.now() < loadDeadline) {
        await page.waitForTimeout(LOADING_POLL_MS);
        const fp = await fingerprint(page);
        const d = fingerprintDelta(last, fp);
        last = fp;
        const stillLoading = await isLoading(page);
        if (d < STABLE_DELTA && !stillLoading) {
          stableRuns++;
          if (stableRuns >= 2) break;
        } else {
          stableRuns = 0;
        }
      }
      // a loading screen must NEVER be the final capture — always record the settled state.
      await capture("waited out loading");
    }

    let interactions = 0;
    /**
     * SIGNING IN OPENS A WHOLE PRODUCT — GIVE IT ROOM.
     *
     * The budget (30 actions / 3 minutes) was sized for a logged-OUT surface: a landing page, a wall,
     * a few public routes. Behind a login there is a console, its sections, its forms — and Sage was
     * exploring all of it on the clock it used for a homepage. That matters beyond thoroughness:
     * every extra screen it genuinely reaches is corpus, and corpus is what lets a tester's honest
     * account be VERIFIED and PAID instead of held. Measured on token-watcher: an authenticated run
     * reached /app/endpoints and /app/models and submitted real forms, which is exactly the material
     * the founder's missions are about.
     *
     * The extension is bounded and only ever granted once actually signed in, so a logged-out run is
     * byte-identical to before.
     */
    const AUTH_EXTRA_INTERACTIONS = 20;
    const AUTH_EXTRA_MS = 90_000;
    const canInteract = () =>
      interactions < MAX_INTERACTIONS + (loggedIn ? AUTH_EXTRA_INTERACTIONS : 0) &&
      Date.now() < deadline + (loggedIn ? AUTH_EXTRA_MS : 0);

    // 3a. dismiss a consent/cookie modal if present (once).
    if (canInteract()) {
      const clicked = await clickByText(page, CONSENT_WORDS);
      if (clicked) {
        interactions++;
        await page.waitForTimeout(700);
        if (!sameOrigin(page.url())) await page.goBack().catch(() => {});
        await capture(`dismissed "${clicked}"`);
      }
    }

    /**
     * COMPLETE a private in-product conversation (an AI/NPC character, a support bot, any message box the
     * founder's goal asks Sage to use): type the FIXED synthetic probe, submit it via the observed Send
     * control (else Enter), then WAIT for an actual response. Each captured state corresponds to something
     * that really happened — the reply state is captured ONLY when new content genuinely appeared, so a
     * "responded" claim can never come from a mere "Talk"/"Meet" label. General: no product strings.
     */
    const SEND_RE = /^(send|send message|submit|reply|post|go|➤|➔|→|▶|↵)$/i;
    const completeConversation = async (
      els: MintedElement[],
    ): Promise<"none" | "sent" | "replied"> => {
      // prefer the field that IS a message box (its own classification says so) over the first
      // typable thing on screen — a nav search box must never swallow the conversation probe.
      const input =
        els.find((e) => e.typable && e.valueKind === "ai_probe") ??
        els.find((e) => e.typable && e.valueKind !== "search") ??
        els.find((e) => e.typable);
      if (!input) return "none";
      const beforeSig = wordSignature(
        states[states.length - 1]?.visibleTextExcerpt ?? "",
      );
      // 1. type the fixed, transparent probe (never model-authored, never a credential).
      const typed = await executeAction(
        page,
        { kind: "type_text", elementId: input.id, valueKind: "ai_probe" },
        els,
      );
      interactions++;
      if (/skipped/i.test(typed.trigger)) return "none"; // a sensitive field → never type, stay honest
      await page.waitForTimeout(300);
      await capture("typed the test message into the conversation", {
        kind: "type",
      });
      // 2. submit via the OBSERVED send control, else Enter.
      const send = els.find((e) => SEND_RE.test(e.label.trim()));
      const submitted = send
        ? await executeAction(
            page,
            { kind: "click_element", elementId: send.id },
            els,
          )
        : await executeAction(page, { kind: "press_key", key: "Enter" }, els);
      interactions++;
      await page.waitForTimeout(900);
      await capture(
        send
          ? `sent the message — ${submitted}`
          : "pressed Enter to send the message",
        { kind: "submit", label: send?.label ?? "" },
      );
      const sentSig = wordSignature(
        states[states.length - 1]?.visibleTextExcerpt ?? "",
      );
      // 3. WAIT for a real response — new visible words that weren't there before or right after sending.
      const replyDeadline = Math.min(deadline, Date.now() + 15_000);
      let replied = false;
      while (Date.now() < replyDeadline) {
        await page.waitForTimeout(1_500);
        const sig = wordSignature(await renderedExcerpt(page));
        if (sig !== sentSig && sig !== beforeSig) {
          replied = true;
          break;
        }
      }
      if (replied)
        await capture("observed the reply in the conversation", {
          kind: "observe_response",
        });
      return replied ? "replied" : "sent";
    };

    /**
     * COMPLETE A FORM — the general case that `completeConversation` was only ever one shape of. Fill
     * every safe field on screen with the value its own type asks for, submit through the form's real
     * control, and wait for the result to actually appear.
     *
     * This is what a tester does and what Sage could not do: typing was reachable only through the
     * conversation path, so any product whose goal ran through a form — a launch form, a search, a
     * create-something flow — could be clicked AT but never THROUGH. Sage would reach the founder's
     * own form, click the submit button with empty fields, watch nothing happen, and report that it
     * could not complete the journey.
     *
     * Bounded on purpose:
     *  - only fields `isSensitiveField` cleared are filled, so no credential, payment or personal
     *    datum is ever entered, and the values are the same closed set of fixed strings;
     *  - a form that REQUIRES something Sage may not type is filled but never submitted — submitting
     *    it would only produce a validation error and a false "I tried" claim;
     *  - a submit control that reads as destructive or as spending money is refused outright;
     *  - one submission per form, deduped by the caller, so this can never become a loop.
     */
    const completeForm = async (
      els: MintedElement[],
    ): Promise<"none" | "filled" | "submitted" | "result"> => {
      const fields = els.filter((e) => e.typable);
      if (fields.length === 0) return "none";
      const beforeSig = wordSignature(
        states[states.length - 1]?.visibleTextExcerpt ?? "",
      );
      const beforeUrl = page.url();

      // 1. fill every safe field with what that field is asking for.
      let filled = 0;
      for (const f of fields.slice(0, 6)) {
        const outcome = await executeAction(
          page,
          {
            kind: "type_text",
            elementId: f.id,
            valueKind: f.valueKind ?? "display_name",
          },
          els,
        );
        interactions++;
        if (!/skipped|did not accept/i.test(outcome.trigger)) filled++;
      }
      // 2. finish any REQUIRED field the mint never saw, and learn whether the form can be honestly
      //    submitted at all. This runs BEFORE the capture so the recorded trigger counts what was
      //    really entered, not what the first pass happened to reach.
      const blocked = await requiredSensitiveFieldPending(page);
      const total = await filledFieldCount(page);
      if (filled === 0 && total === 0) return "none";
      await page.waitForTimeout(250);
      const n = Math.max(filled, total);
      await capture(
        n === 1
          ? "filled in the field on the form"
          : `filled in ${n} fields on the form`,
        { kind: "type" },
      );
      if (blocked) return "filled";

      // 3. submit through the form's OWN control; Enter only when there is none to click.
      const submit = await findSubmitControl(page);
      if (submit === "unsafe") return "filled";
      const submitted = submit
        ? await page
            .locator(`[data-sage-submit="1"]`)
            .first()
            .click({ timeout: 2_500, force: true })
            .then(() => `pressed "${submit}"`)
            .catch(() => "")
        : await executeAction(page, { kind: "press_key", key: "Enter" }, els);
      interactions++;
      if (!submitted) return "filled";
      await page.waitForTimeout(900);
      await capture(
        submit ? `submitted the form — ${submitted}` : "submitted the form",
        { kind: "submit", label: submit || "" },
      );

      // 4. WAIT for the real result. A submitted form that changes nothing has not been completed,
      //    and Sage must never record an outcome it did not watch arrive.
      const sentSig = wordSignature(
        states[states.length - 1]?.visibleTextExcerpt ?? "",
      );
      const resultDeadline = Math.min(deadline, Date.now() + 15_000);
      let landed = false;
      while (Date.now() < resultDeadline) {
        await page.waitForTimeout(1_500);
        if (page.url() !== beforeUrl) {
          landed = true;
          break;
        }
        const sig = wordSignature(await renderedExcerpt(page));
        if (sig !== sentSig && sig !== beforeSig) {
          landed = true;
          break;
        }
      }
      if (landed) {
        // A VALIDATION ERROR IS NOT A RESULT. Labeling it "observed the result" let an error screen
        // credit outcome checkpoints and read as progress, which is how a wizard whose budget step
        // kept rejecting was retried to exhaustion. Same URL + validation wording = the form said no.
        const errorish =
          page.url() === beforeUrl &&
          (await page
            .evaluate(() => {
              const t = (document.body?.innerText || "").toLowerCase();
              return /\b(required|invalid|must be at least|must be|please enter|please provide|try again|too (low|small|short|long))\b/.test(t);
            })
            .catch(() => false));
        await capture(
          errorish ? "the form showed a validation error" : "observed the result after submitting",
          errorish ? { kind: "wait" } : { kind: "observe_response" },
        );
        return errorish ? "submitted" : "result";
      }
      return "submitted";
    };

    // ── GOAL-DIRECTED CONTROLLER ─────────────────────────────────────────────
    // With a founder goal, Sage PURSUES it: each step observe → choose ONE bounded action (a deterministic
    // forward affordance first, else the multimodal controller) → execute in THIS guarded browser → capture
    // the new state → dedup (state,action) to prevent loops → stop at the goal, a real boundary, or a budget.
    const runGoalLoop = async (goal: string): Promise<void> => {
      const tried = new Set<string>();
      const deadLabels = new Set<string>(); // affordances/directions that did nothing HERE (cleared on progress)
      const ineffective = new Map<string, number>();
      /** How many times a single URL has changed under Sage without ever leading anywhere new. */
      const churnAtUrl = new Map<string, number>();
      /** Where Sage arrived. A landing page is where a visitor ARRIVES, not where the product lives. */
      const entryUrl = page.url();
      /**
       * States spent on the entry screen, counted plainly and never reset while Sage is still there.
       *
       * Every cleverer trigger was defeated by the page itself. Label retirement: the demo widget
       * renames its controls on each repaint. Churn with a `journeyAdvanced` reset: the landing copy
       * DESCRIBES the whole flow, so checkpoints kept getting marked observed from marketing text and
       * the count reset before it ever reached the cap. Three deploys, 11 states → 10 → 11.
       *
       * A marketing page can fake progress signals; it cannot fake having been looked at N times.
       */
      let entryStates = 0;
      /** Same-host routes Sage has already opened, so a forced departure never loops between two. */
      const visitedPaths = new Set<string>();
      /**
       * SAME-SITE PATHS SAGE HAS DISCOVERED (path → the link label that revealed it) — seeded from
       * the static crawl, then GROWN from the live DOM every turn. Links are the web's API, and on a
       * client-rendered product they exist ONLY in the rendered DOM: the static seed was EMPTY on
       * commonstack.ai, so the explorer had literally nowhere it could go — Playground, Model
       * Library and Docs sat in the header while it burned its budget re-clicking the hero. Bounded
       * (20 paths, 12 per harvest); paths come from Sage's own read of the page, never a model.
       */
      const livePaths = new Map<string, string>();
      for (const p of ctx.candidatePaths ?? []) livePaths.set(p, "");
      const harvestPaths = async (): Promise<void> => {
        if (livePaths.size >= 20) return;
        const found = await page
          .evaluate(() => {
            const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
            const here = location.pathname + location.search;
            const out: { path: string; label: string }[] = [];
            const seen = new Set<string>();
            for (const a of Array.from(document.querySelectorAll("a[href]"))) {
              const el = a as HTMLAnchorElement;
              try {
                if (!el.host || strip(el.host) !== strip(location.host)) continue;
                const path = el.pathname + el.search;
                if (!path || path === "/" || path === here || path.length > 120) continue;
                if (/log ?out|sign ?out|delete|unsubscribe|\.(pdf|zip|png|jpe?g|svg|mp4|webm)$/i.test(path)) continue;
                if (seen.has(path)) continue;
                seen.add(path);
                const label = (el.innerText || el.getAttribute("aria-label") || "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 60);
                out.push({ path, label });
                if (out.length >= 12) break;
              } catch {
                /* skip */
              }
            }
            // doc-labeled links, including OFF-HOST ones on the same registrable domain — the
            // same-host rule above rightly bounds exploration, but documentation conventionally
            // lives on a subdomain, and dropping it here starved the doc hunt of its best source.
            const docs: { url: string; label: string }[] = [];
            const tail = (h: string) => strip(h).split(".").slice(-2).join(".");
            const DOC = /(^|[^a-z])(docs?|documentation|guide|guides|tutorial|learn|faq|help|whitepaper|litepaper|getting[-\s]?started|quickstart)([^a-z]|$)/i;
            for (const a of Array.from(document.querySelectorAll("a[href]"))) {
              const el = a as HTMLAnchorElement;
              try {
                if (!el.host || tail(el.host) !== tail(location.host)) continue;
                if (!/^https?:$/.test(el.protocol)) continue;
                const label = (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60);
                if (!DOC.test(label) && !DOC.test(el.pathname) && !/^docs?\./i.test(el.host)) continue;
                docs.push({ url: el.href.split("#")[0], label });
                if (docs.length >= 5) break;
              } catch {
                /* skip */
              }
            }
            return { out, docs };
          })
          .catch(() => ({ out: [] as { path: string; label: string }[], docs: [] as { url: string; label: string }[] }));
        for (const f of found.out) {
          if (livePaths.size >= 20) break;
          if (!livePaths.has(f.path)) livePaths.set(f.path, f.label);
        }
        for (const d of found.docs) {
          if (docLinkUrls.size >= 5) break;
          if (!docLinkUrls.has(d.url)) docLinkUrls.set(d.url, d.label);
        }
      };
      const unvisitedPaths = (): string[] =>
        [...livePaths.keys()].filter((p) => !visitedPaths.has(p));
      const history: ControllerHistoryItem[] = [];
      const normL = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const terms = goalTerms(goal);
      const wantsConversation = goalWantsConversation(goal);
      const wantsSearch = goalWantsSearch(goal);
      let modelCalls = 0;
      let stall = 0;
      /** login walls hit after redirects — a couple mean the goal is gated behind auth; stop honestly. */
      let wallHits = 0;
      /** one deterministic reveal-scroll per run, for a thin entry screen (below-the-fold content). */
      let revealScrolled = false;
      /**
       * CYCLE DETECTION by state identity. Same-URL churn is already capped, but a 2-screen cycle
       * (fill → submit → login redirect → back → fill again) resets the churn counter on every hop
       * and never accumulates — measured: commonstack ran its whole fill→submit→login loop twice, and
       * a wizard whose budget step kept rejecting was retried 3–5 times. A state digest recurring is
       * the loop itself, whatever the URLs did: third recurrence retires the screen's controls,
       * fourth ends the run honestly.
       */
      const digestSeen = new Map<string, number>();
      // Budget MEANINGFUL states (real progress), not raw actions, and COMPACT a run of consecutive
      // linear-onboarding states into one budget unit — the whole trace + its transitions are still
      // recorded, but crossing a 15-step signup can never consume the exploration budget.
      let meaningful = 1; // the initial state counts
      let prevOnboarding = false;
      let mainReached = false; // the product's main experience (past linear onboarding)
      let actionCap = MAX_INTERACTIONS;
      let stateCap = MAX_STATES;
      let modelCap = MAX_MODEL_CALLS;
      /** Guarantee a floor of budget for real exploration, bounded by the hard extension ceilings. */
      const reserveBudget = () => {
        actionCap = Math.min(
          EXT_MAX_INTERACTIONS,
          Math.max(actionCap, interactions + RESERVE_ACTIONS),
        );
        stateCap = Math.min(
          EXT_MAX_STATES,
          Math.max(stateCap, meaningful + RESERVE_STATES),
        );
        modelCap = Math.min(
          EXT_MAX_MODEL_CALLS,
          Math.max(modelCap, modelCalls + RESERVE_MODEL_CALLS),
        );
      };
      let prevWordSig = wordSignature(
        states[states.length - 1]?.visibleTextExcerpt ?? "",
      );
      let prevUrl = page.url();
      // Which SCREENS Sage has already completed a form on. Keyed by state digest rather than a single
      // boolean, so a multi-step flow (fill → next screen → fill again) can be carried all the way
      // through, while the same screen is never filled twice.
      const formsDone = new Set<string>();
      // The founder's ordered journey, advanced LIVE from the states captured so far. It decides which
      // target Sage pursues next; completion is evidence-based (see evaluateJourney), never text alone.
      let liveJourney = ctx.journey ?? null;
      // Navigation is bounded: enough to cross into the flow the founder named, not enough to wander
      // the whole site instead of using it.
      let navigations = 0;
      const advanceJourney = () => {
        if (!ctx.journey) return;
        liveJourney = evaluateJourney(
          ctx.journey,
          buildJourneySteps(
            states,
            [],
            [],
            states.map(() => ""),
          ),
        );
      };
      advanceJourney();
      // A filled form field changes the state WITHOUT changing any visible text, so the state digest
      // (url + text + elements) stays identical. This salt advances on every successful fill so the
      // now-meaningful control ("Continue", disabled-until-filled) is no longer treated as already-tried.
      let ctxSalt = 0;

      while (
        interactions < actionCap &&
        meaningful < stateCap &&
        Date.now() < deadline
      ) {
        const cur = states[states.length - 1];
        if (!cur) break;
        const rawDigest = stateDigest(cur);
        const digest = `${rawDigest}#${ctxSalt}`;
        const elements = await mintInteractiveElements(page);
        await harvestPaths(); // the SPA's map lives in the rendered DOM — keep it current each turn
        // cycle guard — the same state recurring is a loop whatever route it took to come back.
        const cycleN = (digestSeen.get(rawDigest) ?? 0) + 1;
        digestSeen.set(rawDigest, cycleN);
        if (cycleN === 3) {
          for (const e of elements) if (e.label.trim()) deadLabels.add(normL(e.label));
        } else if (cycleN >= 4) {
          history.push({ action: "stop:cycle", changed: false, note: "the same screen kept recurring" });
          break;
        }

        // COMPLETE THE TARGET INTERACTION. A conversation is one shape of it (type the probe, send,
        // wait for a reply); a launch form, a search, a create-something flow are the others, and
        // until now only the conversation could be completed at all.
        //
        // A conversation goal jumps the queue: a message box IS the goal, so there is nothing to be
        // gained by clicking past it. A plain form does NOT — the deterministic onboarding affordance
        // is tried first, so a landing page with both "Get started" and a newsletter box still gets
        // started rather than filling in the first input it sees. Forms are completed once the
        // product's main experience is reached, which is where the founder's flow actually lives.
        //
        // `formsDone` is keyed by SCREEN, not a single global latch, so a multi-step flow can be
        // carried through one form at a time while no screen is ever filled twice.
        // NEVER ADVANCE PAST A SCREEN SAGE CAN STILL FILL. A multi-step wizard puts a "Continue →" on
        // every step, so preferring the forward affordance walked Sage through the whole flow with
        // every field empty — and the app then complained about step 1 while Sage was on step 2, with
        // no way back. That is the general shape of a wizard, not one product's quirk.
        //
        // A marketing/onboarding screen has nothing fillable, so it is unaffected and the
        // deterministic forward affordance still wins there. The test is EMPTINESS, not presence: a
        // screen whose fields are already filled is finished, and Sage moves on.
        const formReady =
          !formsDone.has(digest) &&
          (wantsConversation
            ? elements.some((e) => e.typable)
            : await hasEmptySafeField(page, wantsSearch));
        if (formReady) {
          formsDone.add(digest);
          const outcome = wantsConversation
            ? await completeConversation(elements)
            : await completeForm(elements);
          history.push({
            action: `form:${outcome}`,
            changed: outcome !== "none",
            note: "target interaction",
          });
          // A conversation that got a reply IS the founder's goal. A form result is progress, not
          // necessarily the end — the flow may continue on the next screen, so keep going.
          if (outcome === "replied") break;
          prevWordSig = wordSignature(
            states[states.length - 1]?.visibleTextExcerpt ?? "",
          );
          prevUrl = page.url();
          meaningful++;
          reserveBudget();
          continue;
        }

        // 0. LEAVE A SCREEN THAT HAS STOPPED PAYING. Retiring controls by LABEL cannot work here: the
        //    landing page's demo widget renames its affordances on every repaint — "Start", then
        //    "action · Start", then "payout may continue", then "SAGE REPLAYED" — so retiring one only
        //    ever hides a label the page has already replaced. Three attempts at label-level
        //    retirement moved 11 states to 10.
        //
        //    The entry page is where a visitor ARRIVES, not where the product lives; a founder's flow
        //    almost always sits behind a link. So once the entry screen has churned past the cap and
        //    Sage holds a route it has not opened, it goes there — deterministically, without asking
        //    the model to decline the same buttons one more time. A genuine single-page product has no
        //    candidate paths, so nothing here fires and its behaviour is unchanged.
        let action: ControllerAction | null = null;
        const hereUrl = page.url();
        const herePath = (() => {
          try {
            const u = new URL(hereUrl);
            return u.pathname + u.search;
          } catch {
            return "";
          }
        })();
        if (hereUrl === entryUrl) entryStates++;

        // 0a. THE GOAL KNOWS WHERE TO GO. When the current checkpoint names something that is NOT
        //     clickable on this screen but a DISCOVERED same-site path matches it (its link label or
        //     its slug — "Playground" → /playground), go there directly. This is what a person does:
        //     read the nav, follow the link that says the thing. Fires only as a fallback (an
        //     on-screen match is still clicked, which stays cheaper and more faithful), only within
        //     the navigation budget, and only over paths Sage itself read off the product's DOM.
        if (navigations < MAX_NAVIGATIONS) {
          const cpNav = nextUnmetCheckpoint(liveJourney);
          const navTerms = cpNav
            ? targetTerms({ entity: cpNav.targetEntity, context: cpNav.requiredContext })
            : terms;
          if (
            navTerms.length > 0 &&
            !chooseGoalTargetAffordance(elements, navTerms, digest, tried, deadLabels)
          ) {
            const goalPath = chooseGoalPath(
              [...livePaths].map(([path, label]) => ({ path, label })),
              navTerms,
              new Set([...visitedPaths, herePath]),
            );
            if (goalPath) {
              visitedPaths.add(goalPath);
              navigations++;
              action = { kind: "open_path", path: goalPath };
            }
          }
        }

        // 0b. LEAVE A SCREEN THAT HAS STOPPED PAYING (the churn exit — unchanged, now over the LIVE
        //     path set, so a client-rendered product has real routes to leave through).
        if (
          !action &&
          hereUrl === entryUrl &&
          entryStates > ENTRY_STATE_CAP &&
          navigations < MAX_NAVIGATIONS
        ) {
          const next = unvisitedPaths().find((p) => p !== herePath);
          if (next) {
            visitedPaths.add(next);
            navigations++;
            action = { kind: "open_path", path: next };
          }
        }

        // 0c. STARVED FOR PATHS → OPEN THE MENU / REVEAL THE PAGE. When the harvest found almost
        //     nothing to navigate to, the map is usually hiding: behind a burger/nav toggle, or below
        //     the fold. One deterministic menu click per screen, one reveal scroll per run — both are
        //     what a person does on a page that looks empty, and both feed the next harvest. This is
        //     the "could only reach the entry screen" lever (28% of all inspections stopped there).
        if (!action && livePaths.size < 2) {
          action = chooseMenuAffordance(elements, digest, tried, deadLabels);
        }
        if (!action && !revealScrolled && elements.length < 6) {
          revealScrolled = true;
          action = { kind: "scroll", direction: "down" };
        }

        // 1. linear onboarding: the obvious forward control (cheap + deterministic, no model call).
        const forcedExit = !!action;
        if (!action)
          action = chooseForwardAffordance(elements, digest, tried, deadLabels);
        let isOnboarding = !!action && !forcedExit;
        // 2. no forward control ⇒ the MAIN EXPERIENCE is reached: guarantee exploration budget, then go
        //    straight for whatever the GOAL names (a character/entity/interaction visible on screen).
        if (!action) {
          if (!mainReached) {
            mainReached = true;
            reserveBudget();
          }
          // The CURRENT checkpoint is the authority (not broad goal-wide matching): pursue only the next
          // unmet checkpoint's entity, so an entity named during onboarding cannot pull Sage ahead in the
          // journey. With no journey compiled, fall back to the goal's own terms (previous behavior).
          const cp = nextUnmetCheckpoint(liveJourney);
          const currentTerms = cp
            ? targetTerms({
                entity: cp.targetEntity,
                context: cp.requiredContext,
              })
            : terms;
          action = chooseGoalTargetAffordance(
            elements,
            currentTerms,
            digest,
            tried,
            deadLabels,
          );
        }
        let progress: ControllerDecision["goalProgress"] = "advancing";
        // 3. still nothing obvious ⇒ ask the multimodal controller (it sees the screenshot + goal targets).
        if (!action) {
          if (modelCalls >= modelCap) break;
          const img = await screenshotJpegDataUri(page);
          // THE MODEL CANNOT PICK WHAT IT CANNOT SEE. Retirement was only ever consulted by the
          // deterministic choosers, so once the model was driving — which on a marketing page is
          // almost immediately — a retired control was offered back to it every single turn. That is
          // why retiring the landing page changed nothing measurable: job WptzbM8c5klY still spent 11
          // of 26 states on `/`. Passing `deadLabels` alongside the list would only be advice; taking
          // the elements OUT is the enforcement, and it needs no prompt change.
          //
          // An emptied list is the CORRECT outcome on an exhausted screen: with nothing left to click
          // the model's remaining moves are navigation, scrolling, going back, or an honest stop —
          // which is exactly the decision Sage should be making there.
          const liveElements = elements.filter(
            (e) => !deadLabels.has(normL(e.label)),
          );
          const decision = await decideNextAction(
            goal,
            {
              url: page.url(),
              visibleText: cur.visibleTextExcerpt,
              elements: liveElements,
              canvas: await canvasGeomPct(page),
            },
            history,
            actionCap - interactions,
            img,
            ctx.controllerDeps ?? {},
            navigations < MAX_NAVIGATIONS ? unvisitedPaths().slice(0, 8) : [],
          );
          modelCalls++;
          if (!decision) break;
          action = decision.action;
          if (action.kind === "open_path") {
            navigations++;
            visitedPaths.add(action.path);
          }
          progress = decision.goalProgress;
        }
        if (action.kind === "stop") {
          history.push({
            action: `stop:${action.status}`,
            changed: false,
            note: action.reason,
          });
          break; // reached the goal, or an honest boundary (auth / captcha / payment / real person).
        }
        tried.add(actionSignature(digest, action));
        // what was acted on — for context-scoped retirement of a control OR a movement direction that
        // repeatedly produces no goal-relative progress.
        const actedLabel =
          action.kind === "click_element"
            ? affordanceKey(
                elements.find((e) => e.id === action.elementId)?.label ?? "",
              )
            : action.kind === "press_key"
              ? `key:${action.key}`
              : "";
        // did this action move us toward something the goal names? (for verified-progress extension)
        const targetedGoal =
          action.kind === "click_element" &&
          goalMatchScore(
            elements.find((e) => e.id === action.elementId)?.label ?? "",
            terms,
          ) > 0;

        const { trigger, delivered } = await executeAction(page, action, elements);
        interactions++;
        // a failed click that recovered by FOLLOWING the link's own href is a navigation — count it
        // against the same budget so the fallback can never out-travel an explicit open_path, and
        // mark the destination visited so the path choosers never re-open it.
        if (action.kind === "click_element" && trigger.startsWith("opened ")) {
          navigations++;
          const opened = /^opened (\S+)/.exec(trigger)?.[1];
          if (opened) visitedPaths.add(opened);
        }
        await page
          .waitForLoadState("networkidle", { timeout: 5_000 })
          .catch(() => {});
        await page.waitForTimeout(600);
        if (!sameOrigin(page.url())) {
          await page.goBack().catch(() => {});
          await page.waitForTimeout(300);
        }
        // recapture after EVERY action (including a movement burst), tagged with the STRUCTURED action
        // kind so the journey evaluator never has to interpret English.
        await capture(trigger, {
          kind: actionKindOf(action),
          // carry the executor's verdict onto the state, so downstream evidence builders can tell
          // "the product behaved this way" from "Sage could not act here".
          delivered,
          label:
            action.kind === "click_element"
              ? (elements.find((e) => e.id === action.elementId)?.label ?? "")
              : action.kind === "open_path"
                ? action.path // the journey evaluator can then credit "navigate to X" from the path itself
                : "",
        });
        // how many of the founder's checkpoints were observed BEFORE this action, so "did the journey
        // actually move?" is a fact rather than an impression.
        const metBefore =
          liveJourney?.checkpoints.filter((c) => c.status === "observed").length ?? 0;
        advanceJourney(); // evidence-based: only real observations can complete a checkpoint
        const journeyAdvanced =
          (liveJourney?.checkpoints.filter((c) => c.status === "observed").length ?? 0) >
          metBefore;
        // REAL progress = the URL changed or the WORD content changed. Drifting particles / emoji /
        // cosmetic canvas motion move pixels every frame and must never read as progress.
        const newWordSig = wordSignature(
          states[states.length - 1]?.visibleTextExcerpt ?? "",
        );
        // A successful FILL is real progress even though it changes no visible text — a form's value
        // lives in the DOM, not in innerText. Without this, "fill the field then continue" stalls: the
        // continue control looks dead because typing appeared to change nothing.
        const filled =
          action.kind === "type_text" && !/^skipped/i.test(trigger);
        if (filled) ctxSalt++; // the context genuinely changed → previously-dead controls are live again
        const realChange =
          page.url() !== prevUrl || newWordSig !== prevWordSig || filled;
        history.push({ action: trigger, changed: realChange, note: progress });
        if (realChange) {
          // COMPACT consecutive onboarding states: a linear ladder costs ONE unit of the state budget.
          if (!(isOnboarding && prevOnboarding)) meaningful++;
          // RETIRE THE WHOLE SCREEN, not just a label. Retirement was already forgiven only by real
          // movement (below), but the BUDGET was not: on a marketing page whose demo widget repaints,
          // every click is a "real change", so each one bought another unit of the state budget and
          // the run never left. Job Y2RRcUc9OB_Q spent 11 of 26 states on `/` clicking "Start",
          // "action · Start", "payout may continue" and "SAGE REPLAYED" before reaching the app.
          //
          // So churn is counted PER URL. A screen that keeps changing without ever taking Sage
          // somewhere new has been seen; every control on it is retired at once, which pushes the
          // next decision to navigation (`open_path`) instead of one more click into the same page.
          const sameUrl = page.url() === prevUrl;
          if (!sameUrl || filled || journeyAdvanced) {
            // A screen that is GETTING SOMEWHERE — a new url, a field accepted, a founder checkpoint
            // met — has earned a clean slate. Without this reset a genuinely productive screen like a
            // multi-step form accumulates churn between its fills and retires itself mid-flow, which
            // is the exact opposite of the intent.
            churnAtUrl.set(page.url(), 0);
          } else {
            const seen = (churnAtUrl.get(prevUrl) ?? 0) + 1;
            churnAtUrl.set(prevUrl, seen);
            if (seen >= SCREEN_CHURN_CAP) {
              for (const e of elements) if (e.label.trim()) deadLabels.add(normL(e.label));
              if (actedLabel) deadLabels.add(actedLabel);
            }
          }
          // Retirement is forgiven only by REAL movement — a new page, a filled field, or the founder's
          // journey actually advancing. On an animated marketing page every click repaints something,
          // so "the words changed" forgave every dead control and Sage clicked the same hero button
          // forever instead of opening the route that leads to the flow.
          if (page.url() !== prevUrl || filled || journeyAdvanced) {
            deadLabels.clear();
            ineffective.clear();
          }
          stall = 0;
          // THE FOUNDER'S OWN CHECKPOINTS MOVING is the strongest evidence the run is on the right
          // track, and it is the one signal that survives crossing from a marketing page into an app.
          // Without it a run spent its budget on the landing page and reached the actual flow with
          // nothing left — it opened /launch, clicked Continue, touched the first form field, and
          // stopped there, which is exactly where the interesting evidence starts.
          if (journeyAdvanced) reserveBudget();
          // verified goal progress after the main experience → extend, bounded by the hard ceilings.
          else if (mainReached && (targetedGoal || progress === "advancing"))
            reserveBudget();
        } else {
          if (actedLabel) {
            const n = (ineffective.get(actedLabel) ?? 0) + 1;
            ineffective.set(actedLabel, n);
            if (n >= 2) deadLabels.add(actedLabel); // retire this control/direction here
          }
          stall++;
          isOnboarding = false;
        }
        prevOnboarding = isOnboarding && realChange;
        prevWordSig = newWordSig;
        prevUrl = page.url();
        // WALL RECOGNITION — a boundary Sage MUST NOT CROSS appearing on a screen that is not the
        // entry means the last move reached gated territory. Three kinds, all handled identically:
        //   · password  — a login form (commonstack bounced the playground to /settings/login).
        //   · wallet    — a connect-wallet prompt. THIS IS THE NORM IN WEB3, and until now Sage did
        //                 not recognise it: it clicked "Connect Wallet", a wallet modal opened (which
        //                 reads as real progress and forgives the retired control), and it re-clicked
        //                 forever — the "script bot" flailing a founder saw on sagepays' own launch.
        //   · oauth     — "sign in with Google/GitHub/…", the other front door to a gated app.
        //
        // Reaching the wall is SUCCESS, not failure: Sage explored everything up to it, records the
        // boundary as an observation the mission brain designs around, retires the move that led
        // here, steps back, and after a few distinct walls stops honestly.
        if (page.url() !== entryUrl) {
          // VISIBLE, not merely present, and — for wallet/oauth — a real WALL, not a persistent header
          // button. `querySelector('input[type=password]')` matched a hidden login drawer a shop keeps
          // mounted on every page (allbirds went 4 states -> 0). The same trap applies to a nav
          // "Connect Wallet": it is on every page and is not a wall. So the wallet/oauth signal
          // requires a BLOCKING prompt — a dialog offering multiple wallet providers, or content that
          // asks to connect/sign in to continue — never a lone header control.
          // DOM extraction stays in the page; the CLASSIFICATION is a pure, unit-tested function
          // (classifyWallKind) so the wallet/oauth/false-positive rules are provable without a browser.
          const wallSignals = await wallSignalsOf(page);
          const wallKind = wallSignals ? classifyWallKind(wallSignals) : null;
          if (wallKind) {
            wallHits++;
            if (actedLabel) deadLabels.add(actedLabel);
            try {
              const u = new URL(page.url());
              visitedPaths.add(u.pathname + u.search); // never re-open the gated route
            } catch {
              /* keep going */
            }
            /**
             * THE FOUNDER'S TEST ACCOUNT — the one thing that turns a wall into ground truth.
             *
             * Sage cannot pay for work it never saw, so on a product whose value is entirely behind
             * a login it used to design missions about a console it had no observations of, and
             * every honest submission would have HELD. When the founder supplies a TEST account, we
             * log in here (password walls only — planLoginForm refuses OAuth/wallet/OTP forms) and
             * keep exploring with real ground truth. Everything harvested afterwards is REDACTED
             * before it can become corpus, because anchors are published verbatim.
             */
            if (wallKind === "password" && ctx.testAccount && !loggedIn && loginAttempts < 2) {
              loginAttempts++;
              // THE WINDOW OPENS BEFORE THE FIRST KEYSTROKE. attemptLogin captures its own outcome
              // state, so setting this afterwards left the first authenticated screen — the one most
              // likely to show "signed in as <email>" — unredacted. Measured live (vNHD6UOmojlm):
              // the credential reached the stored result through exactly that state.
              authFrom = states.length;
              const ok = await attemptLogin(page, ctx.testAccount, capture);
              if (ok) {
                loggedIn = true;
                wallHits = 0;
                prevWordSig = wordSignature(states[states.length - 1]?.visibleTextExcerpt ?? "");
                prevUrl = page.url();
                continue; // explore the real product now
              }
              authFrom = Number.POSITIVE_INFINITY; // login failed → back on public pages, stop redacting
            }
            const note = wallNoteFor(wallKind);
            // Remember the wall for the doc hunt: Sage cannot walk through it, but the product almost
            // always documents what is behind it, and reading that is what keeps the plan useful.
            wallNote ??= note;
            try {
              walledPaths.push(new URL(page.url()).pathname);
            } catch {
              /* keep going */
            }
            history.push({ action: "auth_wall", changed: true, note });
            if (wallHits >= 3) break;
            await page.goBack().catch(() => {});
            await page.waitForTimeout(400);
            const backNote =
              wallKind === "wallet" ? "stepped back from the connect-wallet wall" : "stepped back from the login wall";
            await capture(backNote, { kind: "back" });
            prevWordSig = wordSignature(states[states.length - 1]?.visibleTextExcerpt ?? "");
            prevUrl = page.url();
            continue;
          }
        }
        if (progress === "reached") break;
        if (stall >= 4) break; // several real-no-progress actions → a genuine stall, stop honestly.
      }
      journeyHadGap = (liveJourney?.checkpoints ?? []).some((c) => c.status !== "observed");
      // hand every discovered path back to the caller for the url-evidence crawl (bounded there).
      ctx.discoveredPathsOut?.push(...livePaths.keys());
      for (const [path, label] of livePaths) linkedPaths.push({ path, label });
    };

    /** The scripted affordance ladder — the no-goal path, and now ALSO the FALLBACK when a
     *  goal-directed run dies early (a controller outage, an instant wall): deterministic affordance
     *  clicking beats returning a one-state inspection while budget remained. */
    const runScriptedLadder = async (): Promise<void> => {
      // 3b. click start/continue controls, in order, capturing each new state.
      let noProgress = 0;
      while (canInteract() && noProgress < 2) {
        const clicked = await clickByText(page, START_WORDS);
        if (!clicked) break;
        interactions++;
        await page
          .waitForLoadState("networkidle", { timeout: 6_000 })
          .catch(() => {});
        await page.waitForTimeout(600);
        if (!sameOrigin(page.url())) {
          await page.goBack().catch(() => {});
          await page.waitForTimeout(400);
        }
        const delta = await capture(`clicked "${clicked}"`);
        noProgress = delta < 2 ? noProgress + 1 : 0;
      }

      // 3b2. explore the actual affordances present — scenes, path choices, icon controls — for a
      // click/choice-driven experience with no "Start" button (yara.garden's world). Each distinct
      // control is clicked once; a control that navigates off-origin is reverted. Never a form submit.
      // The `triedAff` set is SHARED across passes so a later re-scan (after drawing reveals a panel)
      // only clicks the NEW controls, never re-clicking what it already saw.
      const triedAff = new Set<string>();
      const affordancePass = async (budget: number): Promise<number> => {
        let explored = 0;
        let attempts = 0;
        while (canInteract() && explored < budget) {
          // A stretch of controls that can't be clicked produces no captured states, which on a
          // recorded founder run read as "it stopped" — narrate the probing itself every few tries.
          if (++attempts % 8 === 0)
            void recordFieldTestStep(inspectionId, {
              label: `probing controls — ${attempts} tried, ${explored} led somewhere`,
              screenshot: null,
              url: page.url(),
            });
          const r = await clickAffordance(page, triedAff);
          if (!r.ok) {
            if (r.exhausted) break; // nothing left to try
            continue; // this control couldn't be clicked — move to the next one
          }
          explored++;
          interactions++;
          await page
            .waitForLoadState("networkidle", { timeout: 5_000 })
            .catch(() => {});
          await page.waitForTimeout(700);
          if (!sameOrigin(page.url())) {
            await page.goBack().catch(() => {});
            await page.waitForTimeout(400);
          }
          await capture(`explored "${r.label}"`);
        }
        return explored;
      };
      await affordancePass(MAX_AFFORDANCES);

      // 3b3. DRAW on a canvas surface (P21). Select a creation tool (rectangle/ellipse/pen/…) if the app has
      // a toolbar, then make a few safe strokes. This is the excalidraw fix: a drawn shape reveals selection
      // handles + the properties panel (Stroke / Background / Fill / Opacity / …) — the exact states a real
      // tester describes and that Sage otherwise never sees. Then a RE-SCAN clicks the freshly-revealed panel.
      if (
        canInteract() &&
        ctx.signals.hasCanvas &&
        ctx.signals.canvasArea >= CANVAS_MIN_AREA
      ) {
        const tool = await clickByText(page, CREATION_TOOL_WORDS);
        if (tool) {
          interactions++;
          await page.waitForTimeout(400);
          await capture(`selected "${tool}"`);
        }
        const strokes = await drawOnCanvas(page);
        if (strokes > 0) {
          interactions++;
          await page.waitForTimeout(500);
          await capture(
            strokes > 1
              ? `drew ${strokes} shapes on the canvas`
              : "drew on the canvas",
          );
          // the properties panel now exists — re-scan for controls we couldn't see before drawing.
          await affordancePass(Math.floor(MAX_AFFORDANCES / 2));
        }
        // 3b4. right-click for a context menu — more real, firsthand labels (copy, select all, tool options).
        if (canInteract() && (await openContextMenu(page))) {
          interactions++;
          await capture("opened the context menu");
          await page.keyboard.press("Escape").catch(() => {});
        }
      }

      // 3c. a focused canvas: nudge it with a few safe keys (never inside a text input).
      if (
        canInteract() &&
        ctx.signals.hasCanvas &&
        ctx.signals.canvasArea >= CANVAS_MIN_AREA
      ) {
        await focusCanvas(page).catch(() => {});
        const keys = ["Space", "Enter", "ArrowRight", "ArrowUp", "KeyW"];
        for (const key of keys) {
          if (!canInteract()) break;
          // never press a key while a text input is focused (would type / submit).
          if (await textInputFocused(page)) break;
          await page.keyboard.press(key).catch(() => {});
          interactions++;
          await page.waitForTimeout(900);
          const delta = await capture(`pressed ${key}`);
          if (delta < 1 && (key === "Space" || key === "Enter")) {
            // no response to the primary keys → this canvas isn't keyboard-driven; stop nudging.
            break;
          }
        }
      }

      // 3d. one scroll of the final state (reveals below-the-fold content).
      if (canInteract()) {
        const before = prevFp;
        await page
          .evaluate(() => window.scrollBy(0, window.innerHeight))
          .catch(() => {});
        await page.waitForTimeout(500);
        const fp = await fingerprint(page);
        if (fingerprintDelta(before, fp) >= 3) {
          prevFp = before;
          await capture("scrolled");
        }
      }
    }; // end scripted ladder

    const goalText = (ctx.goal ?? "").trim();
    if (goalText) {
      await runGoalLoop(goalText);
      // NEAR-EMPTY GOAL RUN + BUDGET LEFT → the scripted ladder still explores generically. This is
      // the "could only reach the entry screen" tail: an early controller failure or an instant wall
      // used to end the whole exploration at 1–2 states while minutes of budget remained unspent.
      if (states.length <= 2 && Date.now() < deadline) {
        await runScriptedLadder();
      }
    } else {
      await runScriptedLadder();
    }
  } catch {
    /* exploration failed mid-way — keep whatever states we captured */
  }

  // THE DOC HUNT — only when a wall actually stopped Sage, so no ordinary product pays for it.
  // Sage cannot walk through a connect-wallet or sign-in gate, but the product almost always writes
  // down what is behind it. Reading that turns "I was blocked, here is a mission about your landing
  // page" into a plan that knows what a connected user is supposed to see.
  // Fire on a WALL, or on a GOAL GAP with doc links in hand: the founder named steps Sage never
  // observed and the product pointed at its own documentation. Waiting for a classified wall was the
  // clawup failure — /login never classified, so "docs: 0" while /terms displayed "Product Docs".
  const goalGap = journeyHadGap && docLinkUrls.size > 0;
  const huntReason =
    wallNote ?? "the founder's goal names steps Sage could not observe";
  const docs: DocPage[] = (wallNote || goalGap)
    ? await huntDocs({
        page,
        startUrl: ctx.startUrl,
        wallNote: huntReason,
        linkedPaths,
        walledPaths,
        deadline,
        sameOrigin,
        docUrls: [...docLinkUrls].map(([url, label]) => ({ url, label })),
        onRead: (p) =>
          capture(`read the docs at ${p} (blocked by the wall)`, {
            kind: "load",
            label: p,
          }),
        narrate: (label) =>
          void recordFieldTestStep(inspectionId, { label, screenshot: null, url: ctx.startUrl }),
        authenticated: loggedIn,
        credentials: ctx.testAccount ?? undefined,
      })
    : [];

  return {
    ...buildInteractiveSummary({
      startUrl: ctx.startUrl,
      states,
      durationMs: Date.now() - ctx.started,
      limitation:
        states.length > 1
          ? null
          : "Interactive app detected, but exploration could not get past the first state.",
    }),
    ...(docs.length > 0 ? { docs } : {}),
  };
}

/**
 * THE BOUNDARY. If credentials were supplied for this run, NOTHING leaves the field test unswept.
 *
 * Per-capture redaction covers exploration states, but three other harvest paths reach the same
 * artifact — the url-evidence page crawl (which reuses the signed-in session), those pages' CTA
 * lists, and the VISION descriptions of authenticated screenshots, where the model reads the account
 * email straight off the screen. All three leaked a real credential into a stored result (measured:
 * token-watcher VQuT4qQSnEvl). Chasing each site is a losing game; sweeping the artifact once at the
 * boundary is structural, so a harvest path added tomorrow is covered the day it ships.
 */
export async function runFieldTest(
  opts: Parameters<typeof runFieldTestInner>[0],
  deps: FieldTestDeps = {},
): Promise<FieldTestSummary> {
  const summary = await runFieldTestInner(opts, deps);
  if (!opts.testAccount) return summary; // no credentials in play → byte-identical to before
  return redactFieldTestDeep(summary, opts.testAccount);
}

/**
 * THE PASSWORDLESS EMAIL-CODE LOGIN — type the email, ask for the code, read it from the founder's
 * mailbox, type it, submit.
 *
 * This is the shape most products ship now (ClawUp, and anything on Privy/Dynamic), so without it the
 * single most common modern wall stays uncrossable. It runs ONLY when the founder supplied a mailbox
 * Sage can read; the code is fetched in memory and never stored, and the attempt is bounded by the
 * same 2-try cap as a password login.
 */
async function attemptOtpLogin(
  page: Page,
  creds: { email: string; mailbox?: MailboxAccess | null },
  capture: (trigger: string, action?: { kind: FieldTestState["actionKind"]; label?: string; delivered?: boolean }) => Promise<number>,
  readFields: () => Promise<{ id: string; tag: string; type: string; name: string; placeholder: string; autocomplete: string; label: string; typable: boolean }[]>,
): Promise<boolean> {
  if (!creds.mailbox) return false;
  try {
    const beforeUrl = page.url();
    const plan = planOtpForm(await readFields());
    if (!plan) return false; // not an email-code wall either — leave it alone

    const sentAt = new Date();
    await page.fill(`[data-sage-lf="${plan.emailFieldId}"]`, creds.email, { timeout: 5_000 });
    if (plan.sendCodeId) {
      await page.click(`[data-sage-lf="${plan.sendCodeId}"]`, { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(1_200);
    }

    // The code box often only appears AFTER the request goes out — re-plan against the new DOM.
    const after = planOtpForm(await readFields());
    const codeFieldId = after?.codeFieldId ?? plan.codeFieldId;
    if (!codeFieldId) return false;

    const code = await fetchOtpCode(creds.mailbox, sentAt);
    if (!code) {
      await capture("waited for the sign-in code, but none arrived", { kind: "back", delivered: false });
      return false;
    }

    await page.fill(`[data-sage-lf="${codeFieldId}"]`, code, { timeout: 5_000 });
    const submitId = after?.submitId ?? plan.submitId;
    if (submitId) await page.click(`[data-sage-lf="${submitId}"]`, { timeout: 5_000 }).catch(() => {});
    else await page.press(`[data-sage-lf="${codeFieldId}"]`, "Enter").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(900);

    const state = await page.evaluate(() => ({
      url: location.href,
      visibleText: (document.body?.innerText || "").slice(0, 4000),
      stillHasPasswordField: !!document.querySelector('input[type="password"]'),
    }));
    const ok = loginSucceeded({ ...state, beforeUrl });
    await capture(ok ? "signed in with the emailed code" : "the emailed code did not sign in", {
      kind: ok ? "load" : "back",
      delivered: ok,
    });
    return ok;
  } catch {
    return false;
  }
}

/**
 * LOG IN WITH THE FOUNDER'S TEST ACCOUNT. Password walls only.
 *
 * Refuses anything that is not a real password form (planLoginForm returns null for OAuth, wallet
 * and OTP walls), types the supplied credentials, submits, and honestly reports whether it landed.
 * The credential VALUES are never logged, never captured into a state, and never reach a prompt —
 * the only trace is the boolean outcome and the redacted page text.
 */
async function attemptLogin(
  page: Page,
  creds: { email: string; password: string; mailbox?: MailboxAccess | null },
  capture: (trigger: string, action?: { kind: FieldTestState["actionKind"]; label?: string; delivered?: boolean }) => Promise<number>,
): Promise<boolean> {
  try {
    const beforeUrl = page.url();
    // read the form's fields from the live DOM (ids match the click/type executor's element ids)
    const readFields = () => page.evaluate(() => {
      const out: { id: string; tag: string; type: string; name: string; placeholder: string; autocomplete: string; label: string; typable: boolean }[] = [];
      let i = 0;
      for (const el of Array.from(document.querySelectorAll("input, textarea, button, [role=button]"))) {
        const he = el as HTMLElement;
        const r = he.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue; // invisible controls are not a login form
        const tag = he.tagName.toLowerCase();
        const type = (he as HTMLInputElement).type || "";
        out.push({
          id: `lf${i++}`,
          tag,
          type,
          name: he.getAttribute("name") || "",
          placeholder: he.getAttribute("placeholder") || "",
          autocomplete: he.getAttribute("autocomplete") || "",
          label: (he.getAttribute("aria-label") || he.textContent || "").trim().slice(0, 60),
          typable: tag === "input" || tag === "textarea",
        });
        he.setAttribute("data-sage-lf", `lf${i - 1}`);
      }
      return out;
    });
    const fields = await readFields();
    const plan = planLoginForm(fields);
    if (!plan) {
      // NO PASSWORD FIELD — this may still be the passwordless EMAIL-CODE login that ClawUp and most
      // Privy/Dynamic products ship. It is only attemptable when the founder also gave a mailbox
      // Sage can read the code from; without one it stays a wall, exactly as before.
      if (creds.mailbox) return await attemptOtpLogin(page, creds, capture, readFields);
      return false;
    }

    await page.fill(`[data-sage-lf="${plan.emailFieldId}"]`, creds.email, { timeout: 5_000 });
    await page.fill(`[data-sage-lf="${plan.passwordFieldId}"]`, creds.password, { timeout: 5_000 });
    if (plan.submitId) {
      await page.click(`[data-sage-lf="${plan.submitId}"]`, { timeout: 5_000 }).catch(() => {});
    } else {
      await page.press(`[data-sage-lf="${plan.passwordFieldId}"]`, "Enter").catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => ({
      url: location.href,
      visibleText: (document.body?.innerText || "").slice(0, 4000),
      stillHasPasswordField: !!document.querySelector('input[type="password"]'),
    }));
    const ok = loginSucceeded({ ...after, beforeUrl });
    // The trail says what happened, never what was typed.
    await capture(ok ? "signed in with the founder's test account" : "the test account did not sign in", {
      kind: ok ? "load" : "back",
      delivered: ok,
    });
    return ok;
  } catch {
    return false; // a login that throws is simply a wall Sage could not pass
  }
}

/**
 * Click the best VISIBLE element whose text/aria-label matches one of `words`. SAFETY: never a
 * type=submit control and never an element inside a <form> (honors "never submit forms"). Returns
 * the matched label, or null. Runs the match in-page, then Playwright-clicks by a stable handle.
 */
async function clickByText(
  page: Page,
  words: string[],
): Promise<string | null> {
  const idx = await page
    .evaluate((ws: string[]) => {
      const nodes = Array.from(
        document.querySelectorAll(
          'button, [role="button"], a[href], [role="link"]',
        ),
      );
      for (let i = 0; i < nodes.length; i++) {
        const he = nodes[i] as HTMLElement;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        // never submit a form with data. A submit control ASSOCIATED with a form (nested, or linked
        // by the form= attribute → .form is non-null) is skipped; but a standalone <button>Start</button>
        // defaults to type=submit yet submits nothing (no form), so it stays clickable — real "Start"
        // controls are usually exactly that. Belt-and-braces: also skip anything inside a <form>.
        const be = he as HTMLButtonElement;
        if (be.type === "submit" && be.form) continue;
        if (he.closest("form")) continue;
        const label = (he.innerText || he.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (!label || label.length > 40) continue;
        if (
          ws.some(
            (w) =>
              label === w ||
              label.startsWith(w + " ") ||
              label.includes(" " + w),
          )
        ) {
          he.setAttribute("data-sage-click", String(i));
          return { i, label };
        }
      }
      return null;
    }, words)
    .catch(() => null);
  if (!idx) return null;
  try {
    await page
      .locator(`[data-sage-click="${idx.i}"]`)
      .first()
      .click({ timeout: 4_000 });
    await page
      .evaluate(() =>
        document
          .querySelector("[data-sage-click]")
          ?.removeAttribute("data-sage-click"),
      )
      .catch(() => {});
    return idx.label;
  } catch {
    return null;
  }
}

/** Success → the clicked label; `exhausted` → nothing new to try; otherwise a click that failed (try next). */
type AffResult =
  | { ok: true; label: string }
  | { ok: false; exhausted: boolean };

/**
 * Click the most prominent VISIBLE affordance not already tried — a button, link, role=button,
 * .btn/.button, or a pointer-cursor control (an emoji world's ·/🔊/+/− and its clickable scene labels).
 * SAFETY (identical to clickByText): never a form-associated submit, never anything inside a <form>.
 * `seen` (keyed by label/position) is grown so each control is tried at most once. The click is FORCED
 * (a live, animated world constantly moves elements under the cursor and obscures them with drifting
 * particles — the normal actionability wait would just time out); the element was already confirmed
 * visible + safe in-page, so a forced center click is appropriate for exploration.
 */
async function clickAffordance(
  page: Page,
  seen: Set<string>,
): Promise<AffResult> {
  const pick = await page
    .evaluate(
      (seenArr: string[]) => {
        const seenSet = new Set(seenArr);
        const set = new Set<Element>(
          Array.from(
            document.querySelectorAll(
              'button, [role="button"], a[href], [role="link"], [class*="btn" i], [class*="button" i]',
            ),
          ),
        );
        // include pointer-cursor controls that only announce themselves via the cursor (icon buttons AND
        // short clickable scene labels like "Still Pond") — leaf-ish only, so we never grab a huge wrapper.
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const he = el as HTMLElement;
          const t = (he.innerText || "").trim();
          if (t && t.length <= 24 && he.childElementCount <= 1) {
            try {
              if (getComputedStyle(he).cursor === "pointer") set.add(el);
            } catch {
              /* ignore */
            }
          }
        }
        for (const el of set) {
          const he = el as HTMLElement;
          const rect = he.getBoundingClientRect?.();
          if (!rect || rect.width <= 0 || rect.height <= 0) continue;
          const be = he as HTMLButtonElement;
          if (be.type === "submit" && be.form) continue; // never submit a form with data
          if (he.closest("form")) continue;
          const label = (he.innerText || he.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 40);
          const key =
            label || `control@${Math.round(rect.x)},${Math.round(rect.y)}`;
          if (seenSet.has(key)) continue;
          he.setAttribute("data-sage-aff", "1");
          return { key, label: label || "a control" };
        }
        return null;
      },
      [...seen],
    )
    .catch(() => null);
  if (!pick) return { ok: false, exhausted: true };
  seen.add(pick.key); // mark tried whether or not the click lands (never retry the same control)
  try {
    await page
      .locator('[data-sage-aff="1"]')
      .first()
      .click({ timeout: 2_500, force: true });
    await page
      .evaluate(() =>
        document
          .querySelector("[data-sage-aff]")
          ?.removeAttribute("data-sage-aff"),
      )
      .catch(() => {});
    return { ok: true, label: pick.label };
  } catch {
    await page
      .evaluate(() =>
        document
          .querySelector("[data-sage-aff]")
          ?.removeAttribute("data-sage-aff"),
      )
      .catch(() => {});
    return { ok: false, exhausted: false }; // this control failed — the caller tries the next one
  }
}

/** Click the center of the largest canvas to give it focus (a click, never typing). */
async function focusCanvas(page: Page): Promise<void> {
  const box = await page
    .locator("canvas")
    .first()
    .boundingBox()
    .catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await page.mouse
      .click(box.x + box.width / 2, box.y + box.height / 2)
      .catch(() => {});
  }
}

/** The bounding box of the largest canvas on the page (drawing surface), or null. */
async function largestCanvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const boxes = await page
    .locator("canvas")
    .evaluateAll((els) =>
      (els as HTMLCanvasElement[]).map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    )
    .catch(
      () => [] as { x: number; y: number; width: number; height: number }[],
    );
  let best: { x: number; y: number; width: number; height: number } | null =
    null;
  for (const b of boxes)
    if (
      b.width > 0 &&
      b.height > 0 &&
      (!best || b.width * b.height > best.width * best.height)
    )
      best = b;
  return best;
}

/**
 * P21 — DRAW on a canvas surface with a few safe drag strokes (mouse only — never a keystroke, never a
 * form, always inside the surface via {@link canvasStrokes}). This is what makes a drawing app reveal the
 * states a real tester describes: a shape on the canvas, selection handles, and the properties panel that
 * only exists once something is drawn. Returns the number of strokes actually made. Read-adjacent: drawing
 * a throwaway shape mutates only the in-page canvas, never the founder's data or anything off-origin.
 */
async function drawOnCanvas(page: Page): Promise<number> {
  const box = await largestCanvasBox(page);
  if (!box || box.width * box.height < CANVAS_MIN_AREA) return 0;
  const strokes = canvasStrokes(box);
  let made = 0;
  for (const s of strokes) {
    try {
      await page.mouse.move(s.from[0], s.from[1]);
      await page.mouse.down();
      await page.mouse.move(s.to[0], s.to[1], { steps: 8 });
      await page.mouse.up();
      made++;
      await page.waitForTimeout(250);
    } catch {
      break; // a failed gesture — stop drawing, keep whatever landed
    }
  }
  // deselect so a stray later keystroke can't act on the selection (belt-and-braces; we don't type anyway).
  await page.keyboard.press("Escape").catch(() => {});
  return made;
}

/** Right-click the canvas centre to surface a context menu (more real labels: copy, select all, tool
 *  options) — a read-only reveal (no data entered, no form submitted). The caller captures, then Escapes. */
async function openContextMenu(page: Page): Promise<boolean> {
  const box = await largestCanvasBox(page);
  if (!box || box.width * box.height < CANVAS_MIN_AREA) return false;
  try {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
      button: "right",
    });
    await page.waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}

/** Whether a text input / textarea / contenteditable currently has focus (guard against typing). */
async function textInputFocused(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "textarea") return true;
      if (el.isContentEditable) return true;
      if (tag === "input") {
        const t = ((el as HTMLInputElement).type || "text").toLowerCase();
        return ![
          "button",
          "submit",
          "checkbox",
          "radio",
          "range",
          "color",
        ].includes(t);
      }
      return false;
    })
    .catch(() => false);
}

/** Collect visible primary CTA/button texts (top 10). Runs in the page; reads only. */
function extractCtas(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const out: string[] = [];
      const seen = new Set<string>();
      const nodes = Array.from(
        document.querySelectorAll('button, [role="button"], a[href]'),
      );
      for (const el of nodes) {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const buttony =
          he.tagName === "BUTTON" ||
          he.getAttribute("role") === "button" ||
          /\b(btn|button|cta)\b/i.test(he.className || "");
        if (el.tagName === "A" && !buttony) continue; // plain links are not CTAs
        const text = (he.innerText || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 60) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= 10) break;
      }
      return out;
    })
    .catch(() => []);
}

/** Record forms READ-ONLY: method/action/field-names only. Never fills or submits. */
function extractForms(page: Page): Promise<FieldTestForm[]> {
  return page
    .evaluate(() => {
      return Array.from(document.querySelectorAll("form"))
        .slice(0, 8)
        .map((f) => {
          const form = f as HTMLFormElement;
          const fields = Array.from(
            form.querySelectorAll("input, select, textarea"),
          )
            .map((i) => {
              const el = i as HTMLInputElement;
              return el.name || el.id || el.type || "";
            })
            .filter(Boolean)
            .slice(0, 12);
          return {
            method: (form.getAttribute("method") || "get").toLowerCase(),
            action: (form.getAttribute("action") || "").slice(0, 200),
            fields,
          };
        });
    })
    .catch(() => []);
}
