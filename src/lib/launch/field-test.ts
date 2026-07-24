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
import { resolvesPublic } from "./inspect";
import { startEgressProxy } from "@/lib/net/egress-proxy";
import { describeStatesWithVision } from "./vision";
import { stateDigest } from "./observed-facts";
import {
  chooseForwardAffordance,
  decideNextAction,
  actionSignature,
  resolveSyntheticValue,
  isSensitiveField,
  type ControllerAction,
  type ControllerDecision,
  type ControllerHistoryItem,
  type MintedElement,
  type DecideDeps,
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
const MAX_MODEL_CALLS = 12; // multimodal controller decisions (spec cap)
const EXPLORE_MS = 180_000; // 3 minutes hard cap
const LOADING_BUDGET_MS = 60_000;
const LOADING_POLL_MS = 2_000;
const STABLE_DELTA = 4; // % — under this vs the prior poll counts as "settled"
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
export function classifyMode(s: ProductSignals): ProductMode {
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
export function fieldTestForMap(
  summary: FieldTestSummary,
):
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

  const sameOrigin = (u: string): boolean => {
    try {
      return new URL(u).host.toLowerCase() === opts.host.toLowerCase();
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
    context = await browser.newContext({
      userAgent: "SageFieldTest/1.0 (+read-only product field test)",
      viewport: { width: 1280, height: 800 },
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
      signals = await gatherSignals(entryPage, entryRawTextLen);
    } catch {
      /* couldn't load entry — fall through to static (which will degrade honestly) */
    }

    const mode: ProductMode = signals ? classifyMode(signals) : "static";

    if (mode === "interactive") {
      // hand the already-loaded entry page to the state machine.
      const summary = await exploreInteractive({
        page: entryPage,
        startUrl: opts.startUrl,
        inspectionId: opts.inspectionId,
        artifactDir,
        methodsSinceCapture,
        host: opts.host,
        started,
        signals: signals as ProductSignals,
        entryErrors,
        goal: opts.goal,
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
        "button,[role=button],a[href],input,textarea,select,[contenteditable=''],[contenteditable=true],[tabindex],[onclick]";
      const nodes = Array.from(document.querySelectorAll(sel));
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
    const isTextInput =
      (r.tag === "input" && ["text", "search", ""].includes(r.inputType)) ||
      r.tag === "textarea" ||
      r.editable;
    const typable =
      isTextInput &&
      !isSensitiveField({
        type: r.inputType,
        name: r.name,
        id: r.elId,
        placeholder: r.placeholder,
        autocomplete: r.autocomplete,
        ariaLabel: r.ariaLabel,
      });
    const el: MintedElement = {
      id: r.id,
      label: r.label,
      role: r.role,
      tag: r.tag,
      typable,
    };
    if (r.options && r.options.length) el.options = r.options;
    return el;
  });
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
        await page.keyboard.press(action.key);
        return `pressed ${action.key}`;
      case "type_text": {
        const value = resolveSyntheticValue(action.valueKind);
        const el = loc(action.elementId);
        // live re-check — never type into a field that turned out to be a credential/personal-data input.
        const safe = await el
          .evaluate((node) => {
            const he = node as HTMLElement;
            const t = (he.getAttribute("type") || "").toLowerCase();
            const hay = [
              he.getAttribute("name"),
              he.id,
              he.getAttribute("placeholder"),
              he.getAttribute("autocomplete"),
              he.getAttribute("aria-label"),
            ]
              .filter(Boolean)
              .join(" ");
            return (
              !["password", "email", "tel", "number"].includes(t) &&
              !/pass|email|e-mail|phone|tel|mobile|card|cvv|cvc|iban|routing|acct|account\b|ssn|social|secret|token|api[_-]?key|seed|mnemonic|private[_-]?key|wallet|address|street|zip|postal|postcode|dob|birth|passport|licen[sc]e|tax/i.test(
                hay,
              )
            );
          })
          .catch(() => false);
        if (!safe) return "skipped typing (sensitive field)";
        await el.fill(value, { timeout: 2_500 }).catch(async () => {
          await el.click({ force: true }).catch(() => {});
          await page.keyboard.type(value, { delay: 10 }).catch(() => {});
        });
        return action.valueKind === "ai_probe"
          ? "typed a test message"
          : action.valueKind === "display_name"
            ? 'entered the name "Sage Test"'
            : "typed a search term";
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
      return new URL(u).host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  };

  const capture = async (trigger: string): Promise<number> => {
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
    states.push({
      trigger,
      screenshot,
      visibleTextExcerpt: await renderedExcerpt(page),
      notableElements: await notableElements(page),
      pixelDeltaPct: delta,
      url: page.url(),
      networkMethods: methodsSinceCapture.splice(0), // the methods observed since the previous capture
    });
    return delta;
  };

  try {
    // 1. initial state (loading or not — the honest starting point).
    await capture("initial load");

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

    // ── GOAL-DIRECTED CONTROLLER ─────────────────────────────────────────────
    // With a founder goal, Sage PURSUES it: each step observe → choose ONE bounded action (a deterministic
    // forward affordance first, else the multimodal controller) → execute in THIS guarded browser → capture
    // the new state → dedup (state,action) to prevent loops → stop at the goal, a real boundary, or a budget.
    const runGoalLoop = async (goal: string): Promise<void> => {
      const tried = new Set<string>();
      const history: ControllerHistoryItem[] = [];
      let modelCalls = 0;
      let stall = 0;
      while (canInteract() && states.length < MAX_STATES) {
        const cur = states[states.length - 1];
        if (!cur) break;
        const digest = stateDigest(cur);
        const elements = await mintInteractiveElements(page);
        // deterministic forward affordance first (cheap, general — no model call).
        let action: ControllerAction | null = chooseForwardAffordance(
          elements,
          digest,
          tried,
        );
        let progress: ControllerDecision["goalProgress"] = "advancing";
        if (!action) {
          if (modelCalls >= MAX_MODEL_CALLS) break;
          const img = await screenshotJpegDataUri(page);
          const decision = await decideNextAction(
            goal,
            {
              url: page.url(),
              visibleText: cur.visibleTextExcerpt,
              elements,
              canvas: await canvasGeomPct(page),
            },
            history,
            MAX_INTERACTIONS - interactions,
            img,
            ctx.controllerDeps ?? {},
          );
          modelCalls++;
          if (!decision) break;
          action = decision.action;
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
        const sig = actionSignature(digest, action);
        if (tried.has(sig)) {
          stall++;
          if (stall >= 2) break;
        } else stall = 0;
        tried.add(sig);
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
        const delta = await capture(trigger);
        const changed = delta >= 2;
        history.push({ action: trigger, changed, note: progress });
        if (progress === "reached") break;
        stall = changed ? 0 : stall + 1;
        if (stall >= 3) break; // three no-progress actions in a row → an honest stall, stop.
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
