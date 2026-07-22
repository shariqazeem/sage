import "server-only";

/**
 * Rendered evidence capture (W2) — a THREE-STATE rollout: `off | shadow | enforce`.
 *
 * A tester's evidence URL is often a client-rendered SPA: a plain HTTP fetch returns an empty shell
 * (`<div id="root">`), so the payout brain sees no visible text and correctly HOLDS genuine work. This
 * drives the SAME frozen SSRF/request guard the Field Test uses, in a real headless browser, to recover
 * the rendered `innerText` the tester actually saw.
 *
 * ADVERSARIAL BROWSER: the evidence URL is submitter-controlled (they want to get paid) and its
 * JavaScript executes in our headless context. So every subresource request is re-validated against
 * `requestGuard` + a public-host DNS check (verbatim from the Field Test), downloads are refused, popups
 * are closed, the context is ephemeral (no storage, closed after every use), and there is a hard total
 * time cap. Fully failure-isolated: any error returns `text: null` with an outcome category, and the
 * caller keeps the static result.
 *
 * ROLLOUT (this is a NON-MONOTONIC capture change — it can turn a hold into a pay — so it is gated):
 *   off     → never invoked; the static path is byte-identical to pre-W2.
 *   shadow  → the renderer runs and a static-vs-rendered comparison is recorded, but the STATIC evidence
 *             is still what reaches the judge — payout behaviour is byte-for-byte unchanged.
 *   enforce → only after promotion criteria pass may rendered text reach the judge.
 * Any rendered text that DOES reach a model is returned as `EvidenceResult.text` and therefore receives
 * the EXACT same untrusted-content markers, caps, sanitization, and truncation as static evidence.
 *
 * Playwright is a lazy import so `evidence.ts` pulls no browser deps unless a render actually fires.
 */
import { requestGuard } from "@/lib/launch/field-test";
import { resolvesPublic } from "@/lib/launch/inspect";
import { startEgressProxy } from "@/lib/net/egress-proxy";

const NAV_MS = 15_000; // per-navigation budget
const SETTLE_MS = 2_500; // fixed hydration settle AFTER load (networkidle alone is unreliable on SPAs)
const TOTAL_MS = 28_000; // hard cap on the whole render
/** Hard cap on captured innerText: a malicious page can render megabytes of text; bound what crosses the
 *  CDP bridge into our process and what can ever reach the judge (the same bound static evidence gets). */
export const MAX_TEXT_CHARS = 100_000;
export const RENDERER_VERSION = "render-v1";

/**
 * TEST-ONLY injection. Not reachable through production configuration or any environment variable —
 * production calls `renderEvidence(url)` with no hooks, so the guard + public-DNS check apply to every
 * request exactly as before. An integration test passes `allowOrigins` so it can serve fixtures on
 * loopback (which the production guard correctly refuses) WITHOUT weakening that guard: only the exact
 * listed origins bypass it; every other origin — including a DIFFERENT loopback port — still goes through
 * the unmodified `requestGuard` + `resolvesPublic`.
 */
export interface RenderTestHooks {
  allowOrigins?: ReadonlySet<string>;
  /** TEST-ONLY DNS override handed to the egress proxy (simulate rebinding / mixed records). */
  egressLookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  /** TEST-ONLY: extra destination ports the egress proxy may reach (fixtures run on random ports). */
  egressAllowedPorts?: ReadonlySet<number>;
}

export type RenderedEvidenceMode = "off" | "shadow" | "enforce";

/**
 * The rollout state. `RENDERED_EVIDENCE_MODE=off|shadow|enforce` (default off; an unknown value → off).
 * The legacy boolean `RENDERED_EVIDENCE=1` maps to SHADOW — never enforce — so an old arming can never
 * silently change payout behaviour. Only the exact string "enforce" lets rendered text reach the judge.
 */
export function renderedEvidenceMode(): RenderedEvidenceMode {
  const raw = process.env.RENDERED_EVIDENCE_MODE?.trim().toLowerCase();
  if (raw === "shadow" || raw === "enforce" || raw === "off") return raw;
  if (process.env.RENDERED_EVIDENCE === "1") return "shadow"; // legacy → shadow, never enforce
  return "off";
}

export type RenderOutcome =
  | "ok"
  | "engine_missing"
  | "guard_block"
  | "nav_failed"
  | "empty"
  | "timeout"
  | "error";

export interface RenderResult {
  /** the recovered visible text, or null on any failure. */
  text: string | null;
  outcome: RenderOutcome;
  /** the canonical URL after redirects (page.url()), or null. */
  finalUrl: string | null;
}

/**
 * Render a single evidence URL in a guarded headless browser. Same-origin is NOT required (evidence can
 * be on any public host), but the entry AND every subresource must pass `requestGuard` + resolve public.
 */
export async function renderEvidence(rawUrl: string, testHooks?: RenderTestHooks): Promise<RenderResult> {
  // TEST-ONLY loopback bypass (empty in production → no effect). Only exact listed origins skip the guard.
  const bypassOrigin = (url: string): boolean => {
    const origins = testHooks?.allowOrigins;
    if (!origins || origins.size === 0) return false;
    try {
      return origins.has(new URL(url).origin);
    } catch {
      return false;
    }
  };
  if (!bypassOrigin(rawUrl) && !requestGuard(rawUrl).allow) return { text: null, outcome: "guard_block", finalUrl: null };

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { text: null, outcome: "engine_missing", finalUrl: null };
  }

  const hostOk = new Map<string, boolean>();
  const publicHostCached = async (h: string): Promise<boolean> => {
    const cached = hostOk.get(h);
    if (cached !== undefined) return cached;
    const ok = await resolvesPublic(h).catch(() => false);
    hostOk.set(h, ok);
    return ok;
  };

  // AUTHORITATIVE egress boundary: every browser request (nav, redirect, subresource, WebSocket, worker,
  // beacon) is forced through this local proxy, which resolves + validates + pins each destination itself
  // (closing the DNS-rebinding / TOCTOU window a page-level guard leaves open). In production nothing is
  // allowlisted, so loopback + private targets are always refused. In tests the fixture origins are
  // allowlisted and an injected resolver simulates malicious DNS.
  const allowLoopback = new Set<string>();
  if (testHooks?.allowOrigins) {
    for (const o of testHooks.allowOrigins) {
      try {
        const u = new URL(o);
        allowLoopback.add(`${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`);
      } catch {
        /* skip an unparseable test origin */
      }
    }
  }
  const proxy = await startEgressProxy({
    allowLoopback,
    lookup: testHooks?.egressLookup,
    allowedPorts: testHooks?.egressAllowedPorts,
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let timedOut = false;
  const hardTimer = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => {});
  }, TOTAL_MS);
  try {
    browser = await chromium.launch({ headless: true, proxy: { server: proxy.url }, args: proxy.chromiumArgs });
    const context = await browser.newContext({
      userAgent: "SageDeputy/1.0 (+evidence-verification, read-only)",
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
    });
    // The adversarial-browser guard — the Field Test's interceptor, hardened against redirect SSRF.
    const guardOk = async (url: string): Promise<boolean> => {
      if (bypassOrigin(url)) return true; // TEST-ONLY fixture origin (empty in production)
      if (!requestGuard(url).allow) return false;
      let h: string;
      try {
        h = new URL(url).hostname;
      } catch {
        return false;
      }
      return publicHostCached(h);
    };
    // DEFENSE-IN-DEPTH page-level guard (the egress proxy is the authoritative boundary). A plain
    // route.continue() is safe now: a request the browser follows — including a redirect hop — still exits
    // through the proxy, which resolves + validates + pins it, so there is no unguarded egress here.
    await context.route("**/*", async (route) => {
      if (await guardOk(route.request().url())) return void route.continue().catch(() => {});
      return void route.abort().catch(() => {});
    });
    const page = await context.newPage();
    page.on("download", (d) => void d.cancel().catch(() => {})); // refuse downloads
    // Close any popup/new page the evidence tries to open (no OAuth dance, no second tab).
    context.on("page", (p) => {
      if (p !== page) void p.close().catch(() => {});
    });

    const resp = await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: NAV_MS }).catch(() => null);
    if (!resp) return { text: null, outcome: timedOut ? "timeout" : "nav_failed", finalUrl: null };
    // best-effort networkidle (SPAs may never reach it), then a bounded settle for client hydration.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS).catch(() => {});
    const finalUrl = page.url();
    // Cap IN-PAGE before it crosses the bridge — a hostile page can render megabytes of text.
    const text = await page.evaluate((max) => (document.body?.innerText || "").slice(0, max).trim(), MAX_TEXT_CHARS).catch(() => "");
    const clean = text ? text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS) : "";
    return clean ? { text: clean, outcome: "ok", finalUrl } : { text: null, outcome: "empty", finalUrl };
  } catch {
    return { text: null, outcome: timedOut ? "timeout" : "error", finalUrl: null };
  } finally {
    clearTimeout(hardTimer);
    await browser?.close().catch(() => {});
    await proxy.close().catch(() => {});
  }
}
