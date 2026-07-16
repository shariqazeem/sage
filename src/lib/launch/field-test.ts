import "server-only";

/**
 * The "Field Test": Sage actually USES the inspected product in a real headless browser,
 * instead of only reading server-rendered HTML. It reuses the frozen SSRF/public-host guards
 * (validateEvidenceUrl + resolvesPublic) on the entry URL AND on every intercepted request,
 * navigates the entry + a few ranked same-origin pages, and captures what a real visit reveals
 * (screenshots, JS-rendered content, console errors, broken requests). It NEVER fills or submits
 * a form; interaction is limited to same-origin GET navigations. Playwright is imported lazily so
 * this module has no cost (and no dependency) unless the flag is on. Everything is failure-isolated:
 * any error degrades to an honest limitation — the inspection job must never fail because of it.
 *
 * Enabled ONLY when FIELD_TEST_ENABLED=1; otherwise the pipeline behaves exactly as before.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import type { BrowserContext, Page, Route } from "playwright";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";
import { resolvesPublic } from "./inspect";
import type { FieldTestForm, FieldTestSummary } from "./schemas";

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

/** Build the durable summary from raw captures — caps CTAs, filters broken requests, computes jsOnly. Pure. */
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
    pages,
    limitation: input.limitation,
    durationMs: input.durationMs,
  };
}

/** The compact per-page projection fed to the Mission Brain (stays inside the UNTRUSTED boundary). */
export function fieldTestForMap(summary: FieldTestSummary): Array<{
  url: string;
  title: string;
  ctas: string[];
  consoleErrors: string[];
  brokenRequests: { url: string; status: number }[];
  jsOnly: boolean;
}> {
  return summary.pages.map((p) => ({
    url: p.url,
    title: p.title,
    ctas: p.ctas.slice(0, 8),
    consoleErrors: p.consoleErrors.slice(0, 5),
    brokenRequests: p.brokenRequests.slice(0, 5),
    jsOnly: p.jsOnly,
  }));
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
 * Field-test a product: browse the entry URL + up to 5 ranked same-origin pages (≤6 total,
 * ≤90s, ≤15s/page) and return a captured summary. Never throws — any failure returns a summary
 * with `ran:false` (or partial pages) and an honest `limitation`.
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
    ran: false, startUrl: opts.startUrl, pages: [], limitation, durationMs: Date.now() - started,
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
  const captures: FieldTestCapture[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: "SageFieldTest/1.0 (+read-only product field test)",
      viewport: { width: 1280, height: 800 },
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

    for (let i = 0; i < targets.length; i++) {
      if (Date.now() > deadline) break;
      const target = targets[i];
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const failedRequests: { url: string; status: number }[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
      });
      // Only real HTTP failures (status >= 400) count as broken — NOT requests we aborted at the
      // guard (those would misattribute our own SSRF blocks to the product).
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
        // wait for network idle (capped) — this is where JS-rendered content appears.
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
          // Served via an API route, NOT the static path — `next start` won't serve a public/ file
          // written after startup. The file still lives at public/field-tests/<id>/<i>.png on disk.
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildFieldTestSummary({
      startUrl: opts.startUrl,
      captures,
      durationMs: Date.now() - started,
      limitation: captures.length ? "Field test ended early." : `Field test could not run (${msg.slice(0, 80)}).`,
    });
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  return buildFieldTestSummary({
    startUrl: opts.startUrl,
    captures,
    durationMs: Date.now() - started,
    limitation: captures.length ? null : "Field test found no reachable page.",
  });
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
