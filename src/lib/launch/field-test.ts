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
import { describeStatesWithVision } from "./vision";
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

// interactive-explore budgets (spec caps).
const MAX_INTERACTIONS = 12;
const EXPLORE_MS = 180_000; // 3 minutes hard cap
const LOADING_BUDGET_MS = 60_000;
const LOADING_POLL_MS = 2_000;
const STABLE_DELTA = 4; // % — under this vs the prior poll counts as "settled"
const CANVAS_MIN_AREA = 40_000; // ≥ ~200×200: a real surface, not an icon
const ANIMATION_PROBE_MS = 8_000; // watch a thin shell this long for self-animation (early-out on first change)
const MAX_AFFORDANCES = 6; // distinct scene/controls to click in a choice-driven experience

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
export function requestGuard(rawUrl: string): { allow: boolean; reason: string } {
  let protocol: string;
  try {
    protocol = new URL(rawUrl).protocol.toLowerCase();
  } catch {
    return { allow: false, reason: "unparseable url" };
  }
  if (protocol !== "http:" && protocol !== "https:") return { allow: false, reason: `blocked scheme ${protocol}` };
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
export function computeJsOnly(rawHtmlTextLen: number, renderedTextLen: number): boolean {
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
  if (bigCanvas && (s.webgl || s.keyListeners || s.gamepad || thinText)) return "interactive";
  if (s.gamepad && s.hasCanvas) return "interactive";
  // a thin, self-animating or input-driven DOM experience — no canvas required
  if (thinText && (s.selfAnimates || s.keyListeners || s.gamepad)) return "interactive";
  if (s.spaRouting && thinText && (bigCanvas || s.selfAnimates)) return "interactive";
  return "static";
}

/**
 * The honest jsOnly fix (spec 5): near-zero visible text in BOTH the raw HTML and the rendered DOM,
 * with a real canvas, is an INTERACTIVE APP — never "0 JavaScript-only pages". Pure.
 */
export function isInteractiveApp(rawHtmlTextLen: number, renderedTextLen: number, hasBigCanvas: boolean): boolean {
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
export function fingerprintDelta(a: StateFingerprint | null, b: StateFingerprint): number {
  if (!a) return 100;
  const pct = (x: number, y: number): number => {
    const max = Math.max(x, y, 1);
    return (Math.abs(x - y) / max) * 100;
  };
  let canvasDelta = 0;
  if (a.canvasSample && b.canvasSample && a.canvasSample.length === b.canvasSample.length && a.canvasSample.length > 0) {
    let diff = 0;
    for (let i = 0; i < a.canvasSample.length; i++) if (Math.abs(a.canvasSample[i] - b.canvasSample[i]) > 12) diff++;
    canvasDelta = (diff / a.canvasSample.length) * 100;
  }
  return Math.round(Math.max(pct(a.textLen, b.textLen), pct(a.nodeCount, b.nodeCount), canvasDelta));
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
  const states = input.states.slice(0, MAX_INTERACTIONS + 4);
  return {
    ran: states.length > 0,
    startUrl: input.startUrl,
    mode: "interactive",
    pages: [],
    states,
    classification: states.length > 0 ? `Interactive app detected · ${states.length} states explored` : null,
    limitation: input.limitation,
    durationMs: input.durationMs,
  };
}

/**
 * The compact projection fed to the Mission Brain (stays inside the UNTRUSTED boundary). Static
 * mode keeps today's per-page shape; interactive mode surfaces the observed state log so a mission
 * can only be anchored to a state Sage actually reached.
 */
export function fieldTestForMap(summary: FieldTestSummary):
  | { mode: "static"; pages: Array<{ url: string; title: string; ctas: string[]; consoleErrors: string[]; brokenRequests: { url: string; status: number }[]; jsOnly: boolean }> }
  | { mode: "interactive"; classification: string | null; states: Array<{ trigger: string; visibleTextExcerpt: string; notableElements: { tag: string; text: string; role: string }[]; url: string }> } {
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
}

/**
 * Field-test a product. Detects the product mode on entry, then EITHER crawls same-origin pages
 * (static) OR runs the interactive state machine (a client app / game). Never throws — any failure
 * returns a summary with `ran:false` (or partial output) and an honest `limitation`.
 */
export async function runFieldTest(
  opts: { inspectionId: string; startUrl: string; host: string; candidateLinks: string[] },
  deps: FieldTestDeps = {},
): Promise<FieldTestSummary> {
  const isPublicHost = deps.isPublicHost ?? resolvesPublic;
  const allowUrl = deps.allowUrl ?? requestGuard;
  const publicDir = deps.publicDir ?? path.join(process.cwd(), "public");
  const started = Date.now();
  const degrade = (limitation: string): FieldTestSummary => ({
    ran: false, startUrl: opts.startUrl, mode: "static", pages: [], states: [], classification: null,
    limitation, durationMs: Date.now() - started,
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
  if (!(await isPublicHost(entryHost))) return degrade("Field test skipped: host resolves to a private address.");

  // 2. lazy-load the browser engine — optional dependency; absent → honest degrade.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return degrade("Field test unavailable: browser engine not installed (run: npx playwright install --with-deps chromium).");
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
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true });
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
        if (type === "keydown" || type === "keyup") (w.__sage as Record<string, boolean>).keydown = true;
        if (type === "gamepadconnected") (w.__sage as Record<string, boolean>).gamepad = true;
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
    // Request interception: block non-http(s) schemes + any host failing the public-host check.
    await context.route("**/*", async (route: Route) => {
      const url = route.request().url();
      if (!allowUrl(url).allow) return void route.abort().catch(() => {});
      let h: string;
      try {
        h = new URL(url).hostname;
      } catch {
        return void route.abort().catch(() => {});
      }
      if (!(await publicHostCached(h))) return void route.abort().catch(() => {});
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
      const resp = await entryPage.goto(targets[0] ?? opts.startUrl, { waitUntil: "domcontentloaded", timeout: PAGE_MS });
      try {
        const body = await resp?.text();
        if (body) entryRawTextLen = visibleTextLen(body);
      } catch {
        /* keep 0 */
      }
      await entryPage.waitForLoadState("networkidle", { timeout: PAGE_MS }).catch(() => {});
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
        host: opts.host,
        started,
        signals: signals as ProductSignals,
        entryErrors,
      });
      await entryPage.close().catch(() => {});
      // P14 — LOOK at the state screenshots with a vision model (cost-guarded: only when there is
      // more than one state to describe). Failure-isolated: if vision fails or is unconfigured, the
      // summary is returned exactly as the no-vision path (no visionObservations key at all).
      if (summary.states.length > 1) {
        try {
          const vision = await describeStatesWithVision(summary.states, artifactDir, { log: (m) => console.log(m) });
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
      const h1 = (await entryPage.locator("h1").first().innerText({ timeout: 1000 }).catch(() => ""))
        .replace(/\s+/g, " ").trim().slice(0, 200);
      const ctas = await extractCtas(entryPage);
      const forms = await extractForms(entryPage);
      const renderedTextLen = signals?.renderedTextLen ?? (await entryPage.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0));
      let screenshot: string | null = null;
      try {
        await fs.mkdir(artifactDir, { recursive: true });
        await entryPage.screenshot({ path: path.join(artifactDir, `0.png`), fullPage: true });
        screenshot = `/api/field-tests/${opts.inspectionId}/0`;
      } catch {
        screenshot = null;
      }
      captures.push({ url: entryPage.url(), title, h1, ctas, forms, consoleErrors: entryErrors, failedRequests: entryFailed, rawHtmlTextLen: entryRawTextLen, renderedTextLen, screenshot });
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
        if (s >= 400) failedRequests.push({ url: r.url().slice(0, 300), status: s });
      });
      try {
        const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: PAGE_MS });
        let rawHtmlTextLen = 0;
        try {
          const body = await resp?.text();
          if (body) rawHtmlTextLen = visibleTextLen(body);
        } catch {
          /* keep 0 */
        }
        await page.waitForLoadState("networkidle", { timeout: PAGE_MS }).catch(() => {});
        const title = (await page.title().catch(() => "")).slice(0, 200);
        const h1 = (await page.locator("h1").first().innerText({ timeout: 1000 }).catch(() => ""))
          .replace(/\s+/g, " ").trim().slice(0, 200);
        const ctas = await extractCtas(page);
        const forms = await extractForms(page);
        const renderedTextLen = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
        let screenshot: string | null = null;
        try {
          await fs.mkdir(artifactDir, { recursive: true });
          await page.screenshot({ path: path.join(artifactDir, `${i}.png`), fullPage: true });
          screenshot = `/api/field-tests/${opts.inspectionId}/${i}`;
        } catch {
          screenshot = null;
        }
        captures.push({ url: page.url(), title, h1, ctas, forms, consoleErrors, failedRequests, rawHtmlTextLen, renderedTextLen, screenshot });
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
      limitation: captures.length ? null : "Field test found no reachable page.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return degrade(`Field test could not run (${msg.slice(0, 80)}).`);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

/* ───────────────────────── interactive state machine ──────────────────────── */

const START_WORDS = ["start", "play", "enter", "begin", "continue", "skip", "next", "explore"];
const CONSENT_WORDS = ["accept", "agree", "got it", "dismiss", "close", "allow", "ok", "i understand", "continue"];

/** Gather the entry signals (listeners recorded by the init script + a live DOM read). Reads only. */
async function gatherSignals(page: Page, rawHtmlTextLen: number): Promise<ProductSignals> {
  const s = await page
    .evaluate(() => {
      const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
      let canvasArea = 0;
      let webgl = false;
      for (const c of canvases) {
        const area = (c.width || 0) * (c.height || 0);
        if (area > canvasArea) canvasArea = area;
        if (!webgl) {
          try {
            webgl = !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
          } catch {
            /* ignore */
          }
        }
      }
      const w = window as unknown as { __sage?: { keydown?: boolean; gamepad?: boolean; pushState?: number } };
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
  const selfAnimates = renderedTextLen < 600 ? await selfAnimationProbe(page, ANIMATION_PROBE_MS) : false;
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
async function selfAnimationProbe(page: Page, budgetMs: number): Promise<boolean> {
  const snap = () =>
    page
      .evaluate(() => `${(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400)}|${document.querySelectorAll("*").length}`)
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
      const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
      let biggest: HTMLCanvasElement | null = null;
      let area = 0;
      for (const c of canvases) {
        const a = (c.width || 0) * (c.height || 0);
        if (a > area) { area = a; biggest = c; }
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
      return { textLen: text.length, nodeCount: document.querySelectorAll("*").length, canvasSample };
    })
    .catch(() => ({ textLen: 0, nodeCount: 0, canvasSample: null as number[] | null }));
  return fp;
}

/** Rendered DOM visible-text excerpt (NOT raw HTML), capped. */
async function renderedExcerpt(page: Page): Promise<string> {
  return (await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim()).catch(() => ""))
    .slice(0, 700);
}

/** A few notable rendered elements (headings, buttons, inputs) — tag/text/role only. Reads only. */
async function notableElements(page: Page): Promise<{ tag: string; text: string; role: string }[]> {
  return page
    .evaluate(() => {
      const out: { tag: string; text: string; role: string }[] = [];
      const nodes = Array.from(document.querySelectorAll("h1,h2,h3,button,[role=button],a[href],input,label"));
      for (const el of nodes) {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const text = (he.innerText || he.getAttribute("aria-label") || (he as HTMLInputElement).placeholder || "")
          .replace(/\s+/g, " ").trim().slice(0, 80);
        if (!text) continue;
        out.push({ tag: he.tagName.toLowerCase(), text, role: he.getAttribute("role") || "" });
        if (out.length >= 12) break;
      }
      return out;
    })
    .catch(() => []);
}

/** Whether the page is showing a loading state right now (spinner/progress, "loading" text, bare canvas). */
async function isLoading(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const hasSpinner = !!document.querySelector('[class*="spinner" i], [class*="loading" i], [class*="loader" i], progress, [role="progressbar"]');
      const text = (document.body?.innerText || "").trim().toLowerCase();
      const loadingText = /\b(loading|please wait|entering|initializing)\b/.test(text) && text.length < 200;
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      const canvasVisible = !!canvas && (canvas.getBoundingClientRect?.().width ?? 0) > 0;
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
}): Promise<FieldTestSummary> {
  const { page, inspectionId, artifactDir, host } = ctx;
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
      await page.screenshot({ path: path.join(artifactDir, `${shotIdx}.png`), timeout: 8_000 });
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
    const canInteract = () => interactions < MAX_INTERACTIONS && Date.now() < deadline;

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

    // 3b. click start/continue controls, in order, capturing each new state.
    let noProgress = 0;
    while (canInteract() && noProgress < 2) {
      const clicked = await clickByText(page, START_WORDS);
      if (!clicked) break;
      interactions++;
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
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
    const triedAff = new Set<string>();
    let explored = 0;
    while (canInteract() && explored < MAX_AFFORDANCES) {
      const r = await clickAffordance(page, triedAff);
      if (!r.ok) {
        if (r.exhausted) break; // nothing left to try
        continue; // this control couldn't be clicked — move to the next one
      }
      explored++;
      interactions++;
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(700);
      if (!sameOrigin(page.url())) {
        await page.goBack().catch(() => {});
        await page.waitForTimeout(400);
      }
      await capture(`explored "${r.label}"`);
    }

    // 3c. a focused canvas: nudge it with a few safe keys (never inside a text input).
    if (canInteract() && ctx.signals.hasCanvas && ctx.signals.canvasArea >= CANVAS_MIN_AREA) {
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
      await page.evaluate(() => window.scrollBy(0, window.innerHeight)).catch(() => {});
      await page.waitForTimeout(500);
      const fp = await fingerprint(page);
      if (fingerprintDelta(before, fp) >= 3) {
        prevFp = before;
        await capture("scrolled");
      }
    }
  } catch {
    /* exploration failed mid-way — keep whatever states we captured */
  }

  return buildInteractiveSummary({
    startUrl: ctx.startUrl,
    states,
    durationMs: Date.now() - ctx.started,
    limitation: states.length > 1 ? null : "Interactive app detected, but exploration could not get past the first state.",
  });
}

/**
 * Click the best VISIBLE element whose text/aria-label matches one of `words`. SAFETY: never a
 * type=submit control and never an element inside a <form> (honors "never submit forms"). Returns
 * the matched label, or null. Runs the match in-page, then Playwright-clicks by a stable handle.
 */
async function clickByText(page: Page, words: string[]): Promise<string | null> {
  const idx = await page
    .evaluate((ws: string[]) => {
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], a[href], [role="link"]'));
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
        const label = (he.innerText || he.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!label || label.length > 40) continue;
        if (ws.some((w) => label === w || label.startsWith(w + " ") || label.includes(" " + w))) {
          he.setAttribute("data-sage-click", String(i));
          return { i, label };
        }
      }
      return null;
    }, words)
    .catch(() => null);
  if (!idx) return null;
  try {
    await page.locator(`[data-sage-click="${idx.i}"]`).first().click({ timeout: 4_000 });
    await page.evaluate(() => document.querySelector("[data-sage-click]")?.removeAttribute("data-sage-click")).catch(() => {});
    return idx.label;
  } catch {
    return null;
  }
}

/** Success → the clicked label; `exhausted` → nothing new to try; otherwise a click that failed (try next). */
type AffResult = { ok: true; label: string } | { ok: false; exhausted: boolean };

/**
 * Click the most prominent VISIBLE affordance not already tried — a button, link, role=button,
 * .btn/.button, or a pointer-cursor control (an emoji world's ·/🔊/+/− and its clickable scene labels).
 * SAFETY (identical to clickByText): never a form-associated submit, never anything inside a <form>.
 * `seen` (keyed by label/position) is grown so each control is tried at most once. The click is FORCED
 * (a live, animated world constantly moves elements under the cursor and obscures them with drifting
 * particles — the normal actionability wait would just time out); the element was already confirmed
 * visible + safe in-page, so a forced center click is appropriate for exploration.
 */
async function clickAffordance(page: Page, seen: Set<string>): Promise<AffResult> {
  const pick = await page
    .evaluate((seenArr: string[]) => {
      const seenSet = new Set(seenArr);
      const set = new Set<Element>(Array.from(document.querySelectorAll('button, [role="button"], a[href], [role="link"], [class*="btn" i], [class*="button" i]')));
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
        const label = (he.innerText || he.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40);
        const key = label || `control@${Math.round(rect.x)},${Math.round(rect.y)}`;
        if (seenSet.has(key)) continue;
        he.setAttribute("data-sage-aff", "1");
        return { key, label: label || "a control" };
      }
      return null;
    }, [...seen])
    .catch(() => null);
  if (!pick) return { ok: false, exhausted: true };
  seen.add(pick.key); // mark tried whether or not the click lands (never retry the same control)
  try {
    await page.locator('[data-sage-aff="1"]').first().click({ timeout: 2_500, force: true });
    await page.evaluate(() => document.querySelector("[data-sage-aff]")?.removeAttribute("data-sage-aff")).catch(() => {});
    return { ok: true, label: pick.label };
  } catch {
    await page.evaluate(() => document.querySelector("[data-sage-aff]")?.removeAttribute("data-sage-aff")).catch(() => {});
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
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
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
        return !["button", "submit", "checkbox", "radio", "range", "color"].includes(t);
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
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], a[href]'));
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
          const fields = Array.from(form.querySelectorAll("input, select, textarea"))
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
