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
  targetTerms,
  goalTerms,
  goalWantsConversation,
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
  FieldTestForm,
  FieldTestState,
  FieldTestSummary,
  ProductMode,
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
  };
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
      }>;
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
    } {
  if (summary.mode === "interactive") {
    return {
      mode: "interactive",
      classification: summary.classification,
      states: summary.states.slice(0, MAX_INTERACTIONS + 4).map((s) => ({
        trigger: s.trigger,
        visibleTextExcerpt: s.visibleTextExcerpt.slice(0, 600),
        notableElements: s.notableElements.slice(0, 10),
        url: s.url,
      })),
    };
  }
  return {
    mode: "static",
    pages: summary.pages.map((p) => ({
      url: p.url,
      title: p.title,
      ctas: p.ctas.slice(0, 8),
      consoleErrors: p.consoleErrors.slice(0, 5),
      brokenRequests: p.brokenRequests.slice(0, 5),
      jsOnly: p.jsOnly,
    })),
  };
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
export async function runFieldTest(
  opts: {
    inspectionId: string;
    startUrl: string;
    host: string;
    candidateLinks: string[];
    goal?: string;
    /** the founder's compiled ordered journey — drives WHICH target Sage pursues next. */
    journey?: GoalJourneyV1 | null;
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
  const targets = [opts.startUrl, ...opts.candidateLinks.filter(sameOrigin)]
    .map((u) => u.replace(/#.*$/, ""))
    .filter((u) => (seenTargets.has(u) ? false : (seenTargets.add(u), true)))
    .slice(0, MAX_PAGES);

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
    try {
      const resp = await entryPage.goto(targets[0] ?? opts.startUrl, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_MS,
      });
      try {
        const body = await resp?.text();
        if (body) entryRawTextLen = visibleTextLen(body);
      } catch {
        /* keep 0 */
      }
      await entryPage
        .waitForLoadState("networkidle", { timeout: PAGE_MS })
        .catch(() => {});
      // REBASE the live host onto where the product actually landed (post-redirect). Every hop was
      // validated by the egress boundary; this only fixes the same-site scope for the rest of the run.
      try {
        const landed = new URL(entryPage.url()).host;
        if (landed) liveHost = landed;
      } catch {
        /* keep the caller's host */
      }
      signals = await gatherSignals(entryPage, entryRawTextLen);
    } catch {
      /* couldn't load entry — fall through to static (which will degrade honestly) */
    }

    // the founder's intent, decided ONCE from the compiled journey (authoritative) or the goal's words.
    const requiresUse = goalRequiresUse(opts.goal, opts.journey ?? null);
    const mode: ProductMode = signals
      ? classifyMode(signals, requiresUse)
      : "static";

    if (mode === "interactive") {
      // hand the already-loaded entry page to the state machine.
      const summary = await exploreInteractive({
        page: entryPage,
        startUrl: opts.startUrl,
        inspectionId: opts.inspectionId,
        artifactDir,
        methodsSinceCapture,
        host: liveHost,
        started,
        signals: signals as ProductSignals,
        entryErrors,
        goal: opts.goal,
        journey: opts.journey ?? null,
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
          opts.candidateLinks ?? [],
          liveHost,
        );
        if (pageCaps.length > 0) {
          const asPages = buildFieldTestSummary({
            startUrl: opts.startUrl,
            captures: pageCaps,
            durationMs: 0,
            limitation: null,
          }).pages;
          return { ...summary, pages: [...(summary.pages ?? []), ...asPages] };
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
      });
      // SPA LINK DISCOVERY — a client-rendered content site serves raw HTML with no links, so the
      // static inspector found nothing and `targets` holds only the entry URL. The RENDERED DOM is
      // where its navigation actually exists; harvest same-site links from it so a JS-rendered
      // product gets a real multi-page crawl instead of a one-page map.
      if (targets.length < MAX_PAGES) {
        const rendered = await entryPage
          .evaluate(() =>
            Array.from(document.querySelectorAll("a[href]"))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter(Boolean)
              .slice(0, 40),
          )
          .catch(() => [] as string[]);
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
        });
      } catch {
        /* per-page failure — skip this page, keep the run going */
      } finally {
        await page.close().catch(() => {});
      }
    }

    return buildFieldTestSummary({
      startUrl: opts.startUrl,
      captures,
      durationMs: Date.now() - started,
      limitation: captures.length
        ? null
        : "Field test found no reachable page.",
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
  return (
    await page
      .evaluate(() =>
        (document.body?.innerText || "")
          .replace(/[^\S\n]+/g, " ") // collapse spaces/tabs but KEEP newlines
          .replace(/\n{2,}/g, "\n") // squeeze blank lines
          .trim(),
      )
      .catch(() => "")
  ).slice(0, 900);
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
    return el;
  });
}

/** The STRUCTURED kind of a controller action — what the journey evaluator reasons over (never English). */
function actionKindOf(action: ControllerAction): FieldTestState["actionKind"] {
  switch (action.kind) {
    case "click_element":
    case "click_coords":
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
 */
async function hasEmptySafeField(page: Page): Promise<boolean> {
  return (await pendingRequiredFields(page)).some((f) => !isSensitiveField(f));
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
async function executeAction(
  page: Page,
  action: ControllerAction,
  elements: MintedElement[],
): Promise<string> {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const loc = (id: string) => page.locator(`[data-sage-eid="${id}"]`).first();
  const labelOf = (id: string) =>
    (elements.find((e) => e.id === id)?.label ?? id).slice(0, 40);
  try {
    switch (action.kind) {
      case "click_element":
        await loc(action.elementId).click({ timeout: 2_500, force: true });
        return `clicked "${labelOf(action.elementId)}"`;
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
    return `attempted ${action.kind} (no effect)`;
  }
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
  /** same-host pages the static crawl discovered — the only routes `open_path` may take. */
  candidatePaths?: readonly string[];
  /** controller deps (scripted decider for fixtures; real multimodal model otherwise). */
  controllerDeps?: DecideDeps;
}): Promise<FieldTestSummary> {
  const { page, inspectionId, artifactDir, host, methodsSinceCapture } = ctx;
  const deadline = ctx.started + EXPLORE_MS;
  const states: FieldTestState[] = [];
  let prevFp: StateFingerprint | null = null;
  let shotIdx = 0;

  const sameOrigin = (u: string): boolean => {
    try {
      return sameSiteHost(new URL(u).host, host);
    } catch {
      return false;
    }
  };

  const capture = async (
    trigger: string,
    action?: { kind: FieldTestState["actionKind"]; label?: string },
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
    void recordFieldTestStep(inspectionId, {
      label: trigger,
      screenshot,
      url: page.url(),
    });
    states.push({
      trigger,
      screenshot,
      visibleTextExcerpt: await renderedExcerpt(page),
      notableElements: await notableElements(page),
      pixelDeltaPct: delta,
      url: page.url(),
      networkMethods: methodsSinceCapture.splice(0), // the methods observed since the previous capture
      // the STRUCTURED action that produced this state (minted here, never parsed from English) — the
      // goal-journey evaluator reasons over these, so "sent" can never be mistaken for "received".
      ...(action?.kind ? { actionKind: action.kind } : {}),
      ...(action?.label ? { actedLabel: action.label.slice(0, 80) } : {}),
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
    const canInteract = () =>
      interactions < MAX_INTERACTIONS && Date.now() < deadline;

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
      const input = els.find((e) => e.typable);
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
      if (/skipped/i.test(typed)) return "none"; // a sensitive field → never type, stay honest
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
        if (!/skipped|did not accept/i.test(outcome)) filled++;
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
      if (landed)
        await capture("observed the result after submitting", {
          kind: "observe_response",
        });
      return landed ? "result" : "submitted";
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
      const history: ControllerHistoryItem[] = [];
      const normL = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const terms = goalTerms(goal);
      const wantsConversation = goalWantsConversation(goal);
      let modelCalls = 0;
      let stall = 0;
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
        const digest = `${stateDigest(cur)}#${ctxSalt}`;
        const elements = await mintInteractiveElements(page);

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
            : await hasEmptySafeField(page));
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
        if (hereUrl === entryUrl) entryStates++;
        if (
          hereUrl === entryUrl &&
          entryStates > ENTRY_STATE_CAP &&
          navigations < MAX_NAVIGATIONS
        ) {
          const next = (ctx.candidatePaths ?? []).find(
            (p) => !visitedPaths.has(p),
          );
          if (next) {
            visitedPaths.add(next);
            navigations++;
            action = { kind: "open_path", path: next };
          }
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
            navigations < MAX_NAVIGATIONS ? (ctx.candidatePaths ?? []) : [],
          );
          modelCalls++;
          if (!decision) break;
          action = decision.action;
          if (action.kind === "open_path") navigations++;
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

        const trigger = await executeAction(page, action, elements);
        interactions++;
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
          label:
            action.kind === "click_element"
              ? (elements.find((e) => e.id === action.elementId)?.label ?? "")
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
        if (progress === "reached") break;
        if (stall >= 4) break; // several real-no-progress actions → a genuine stall, stop honestly.
      }
    };

    const goalText = (ctx.goal ?? "").trim();
    if (goalText) {
      await runGoalLoop(goalText);
    } else {
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
        while (canInteract() && explored < budget) {
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
    } // end legacy scripted ladder (no-goal path)
  } catch {
    /* exploration failed mid-way — keep whatever states we captured */
  }

  return buildInteractiveSummary({
    startUrl: ctx.startUrl,
    states,
    durationMs: Date.now() - ctx.started,
    limitation:
      states.length > 1
        ? null
        : "Interactive app detected, but exploration could not get past the first state.",
  });
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
