import "server-only";

import { createHash } from "node:crypto";
import { startEgressProxy } from "@/lib/net/egress-proxy";
import type { ActionTransitionV1, ObservationSetV1, SafeVerb } from "./observed-facts";

/**
 * Safe ACTIVE inspection replay — make Sage visibly act, not only read.
 *
 * At INSPECTION time (never payout), Sage can re-perform a safe action it already executed during the
 * field test and check that the same observable change still happens. This is a robustness/drift signal
 * for mission design — it NEVER touches money, mission acceptance, or a tester (there is no tester at
 * inspection time). It is off by default; in `shadow` it may run and emit telemetry only.
 *
 * A probe is built ONLY from an ActionTransitionV1 Sage genuinely executed and observed. Hard limits,
 * all enforced deterministically before any browser opens:
 *   · verb ∈ {click, press, scroll} — never type/fill/submit/navigate-by-URL;
 *   · a robust locator taken from the observed element (role + exact accessible name), never model-authored;
 *   · the target must resolve to EXACTLY ONE element or the probe is locator_ambiguous;
 *   · the expected change must be grounded in a `seen` fact of the after-state;
 *   · the original transition must be classified `safe` and must not have emitted a state-changing request;
 *   · it runs through the guarded egress boundary, in a fresh ephemeral context, bounded + cleaned up.
 *
 * A "reproduced" result is emitted ONLY after the browser actually performed the action and verified the
 * change — never inferred.
 */

export const INSPECTION_PROBE_VERSION = "inspection-probe-v1";
const NAV_MS = 12_000;
const ACTION_MS = 6_000;
const TOTAL_MS = 25_000;

export type ReplayMode = "off" | "shadow";

export function inspectionReplayMode(): ReplayMode {
  const v = process.env.INSPECTION_REPLAY_MODE?.trim().toLowerCase();
  return v === "shadow" ? "shadow" : "off"; // default off; unknown → off
}

export interface InspectionProbeV1 {
  version: typeof INSPECTION_PROBE_VERSION;
  id: string;
  startUrl: string;
  beforeStateDigest: string;
  verb: Extract<SafeVerb, "click" | "press" | "scroll">;
  locator: { role?: string; accessibleName?: string; raw?: string };
  /** for press: the key to send (from the observed transition). */
  key?: string;
  /** visible texts we EXPECT to appear after the action (grounded in the after-state's seen facts). */
  expectedAddedTexts: string[];
  expectedAfterUrl: string;
  /** the originating transition + the after-state's seen fact ids (provenance; never fabricated). */
  sourceTransitionId: string;
  sourceFactIds: string[];
  timeoutMs: number;
}

export type ProbeClassification =
  | "reproduced"
  | "product_drift"
  | "locator_ambiguous"
  | "no_observable_change"
  | "probe_flake"
  | "infrastructure_failure"
  | "unsafe_rejected";

export interface ReplayEvent {
  event: "replay_started" | "replay_action" | "replay_observed" | "replay_reproduced" | "replay_failed";
  probeId: string;
  detail?: string;
  /** on replay_failed, the exact category. */
  category?: ProbeClassification;
}

export interface ProbeResult {
  classification: ProbeClassification;
  probeId: string;
  events: ReplayEvent[];
  /** short machine reason; never raw page content. */
  reason: string;
  observedChange: boolean;
}

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const REPLAY_VERBS = new Set<SafeVerb>(["click", "press", "scroll"]);

/**
 * Build a probe from a transition + its observation set — or REJECT it deterministically. Returns the
 * probe, or `{ rejected }` with a machine reason. No browser is touched here.
 */
export function buildProbe(transition: ActionTransitionV1, set: ObservationSetV1): { probe: InspectionProbeV1 } | { rejected: string } {
  if (transition.safeClassification !== "safe") return { rejected: "unsafe_transition" };
  if (transition.networkMethodSummary === "state_changing") return { rejected: "state_changing_request" };
  if (!REPLAY_VERBS.has(transition.verb)) return { rejected: `verb_not_replayable:${transition.verb}` };
  const loc = transition.locator;
  const hasLocator = !!(loc.role || loc.accessibleName || loc.raw);
  // click/press need a concrete target; scroll can act on the viewport.
  if (transition.verb !== "scroll" && !hasLocator) return { rejected: "no_locator" };

  // the expectation MUST be grounded in a `seen` fact of the after-state — never invented.
  const afterFacts = set.facts.filter((f) => f.decisive && f.grounding === "seen" && f.stateId === transition.afterStateDigest);
  const expectedAddedTexts = [...new Set(transition.addedTexts)].filter((t) => afterFacts.some((f) => f.visibleTexts.some((x) => x.includes(t) || t.includes(x)))).slice(0, 8);
  if (expectedAddedTexts.length === 0 && transition.observableChange) {
    // observed a change but it isn't grounded in a seen fact → we cannot verify it safely.
    return { rejected: "expectation_not_grounded" };
  }

  const key = transition.verb === "press" ? loc.accessibleName || loc.raw : undefined;
  // a press probe must resolve to an ALLOWLISTED key — never a synthesized Enter fallback.
  if (transition.verb === "press" && !allowedKey(key)) return { rejected: `key_not_allowlisted:${key ?? "none"}` };
  const probe: InspectionProbeV1 = {
    version: INSPECTION_PROBE_VERSION,
    id: sha16(JSON.stringify([transition.id, transition.verb, loc, expectedAddedTexts])),
    startUrl: transition.startUrl,
    beforeStateDigest: transition.beforeStateDigest,
    verb: transition.verb as InspectionProbeV1["verb"],
    locator: loc,
    ...(key ? { key } : {}),
    expectedAddedTexts,
    expectedAfterUrl: transition.afterUrl,
    sourceTransitionId: transition.id,
    sourceFactIds: afterFacts.map((f) => f.id).sort(),
    timeoutMs: NAV_MS,
  };
  return { probe };
}

/** All replayable probes for a set — deterministic; safety rejections are simply omitted. */
export function buildProbes(set: ObservationSetV1): InspectionProbeV1[] {
  const out: InspectionProbeV1[] = [];
  for (const t of set.transitions) {
    const r = buildProbe(t, set);
    if ("probe" in r) out.push(r.probe);
  }
  return out;
}

interface ReplayDeps {
  /** TEST-ONLY: loopback fixtures the egress proxy may reach + a chromium override. */
  allowLoopback?: ReadonlySet<string>;
  egressAllowedPorts?: ReadonlySet<number>;
  chromiumLauncher?: () => Promise<typeof import("playwright").chromium>;
  log?: (e: ReplayEvent) => void;
}

/**
 * Execute a probe in a guarded headless browser and classify the outcome. NEVER throws; a failure is a
 * classification. A "reproduced" event is emitted ONLY after the browser performed + verified the change.
 * Runs only in shadow mode (the caller checks); it cannot affect money or mission acceptance.
 */
export async function runInspectionProbe(probe: InspectionProbeV1, deps: ReplayDeps = {}): Promise<ProbeResult> {
  const events: ReplayEvent[] = [];
  const emit = (e: ReplayEvent) => { events.push(e); deps.log?.(e); };
  const done = (classification: ProbeClassification, reason: string, observedChange: boolean): ProbeResult => {
    if (classification !== "reproduced") emit({ event: "replay_failed", probeId: probe.id, category: classification, detail: reason });
    return { classification, probeId: probe.id, events, reason, observedChange };
  };
  emit({ event: "replay_started", probeId: probe.id, detail: `${probe.verb} @ ${probe.startUrl}` });

  let chromium: typeof import("playwright").chromium;
  try {
    chromium = deps.chromiumLauncher ? await deps.chromiumLauncher() : (await import("playwright")).chromium;
  } catch {
    return done("infrastructure_failure", "browser engine unavailable", false);
  }

  const proxy = await startEgressProxy({ allowLoopback: deps.allowLoopback, allowedPorts: deps.egressAllowedPorts });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let timedOut = false;
  const hardTimer = setTimeout(() => { timedOut = true; void browser?.close().catch(() => {}); }, TOTAL_MS);
  try {
    browser = await chromium.launch({ headless: true, proxy: { server: proxy.url }, args: proxy.chromiumArgs });
    const context = await browser.newContext({ acceptDownloads: false, userAgent: "SageInspectionReplay/1.0 (+read-only)" });
    const page = await context.newPage();
    page.on("download", (d) => void d.cancel().catch(() => {}));
    context.on("page", (p) => { if (p !== page) void p.close().catch(() => {}); }); // close popups, never the main page

    const resp = await page.goto(probe.startUrl, { waitUntil: "domcontentloaded", timeout: NAV_MS }).catch(() => null);
    if (!resp) return done(timedOut ? "probe_flake" : "infrastructure_failure", "entry navigation failed", false);

    const before = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim()).catch(() => "");

    // locator — required + must resolve to EXACTLY one element for a CLICK; press/scroll act on the page.
    let locator = null as ReturnType<typeof page.getByRole> | null;
    if (probe.verb === "click") {
      locator = probe.locator.role && probe.locator.accessibleName
        ? page.getByRole(probe.locator.role as Parameters<typeof page.getByRole>[0], { name: probe.locator.accessibleName, exact: true })
        : page.getByText(probe.locator.accessibleName || probe.locator.raw || "", { exact: true });
    }
    if (locator) {
      const count = await locator.count().catch(() => 0);
      if (count === 0) return done("product_drift", "target element not found", false);
      if (count > 1) return done("locator_ambiguous", `target matched ${count} elements`, false);
    }

    emit({ event: "replay_action", probeId: probe.id, detail: probe.verb });
    try {
      if (probe.verb === "click") await locator!.click({ timeout: ACTION_MS });
      else if (probe.verb === "press") {
        const key = allowedKey(probe.key);
        if (!key) return done("unsafe_rejected", `key not on allowlist: ${probe.key ?? "none"}`, false);
        await page.keyboard.press(key); // page-level key; the field test's press was a global key event
      } else await page.mouse.wheel(0, 800);
    } catch {
      return done(timedOut ? "probe_flake" : "product_drift", "action could not be performed", false);
    }
    await page.waitForTimeout(1_200).catch(() => {});

    const after = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim()).catch(() => "");
    emit({ event: "replay_observed", probeId: probe.id });
    const observedChange = after !== before || page.url() !== probe.startUrl;
    if (!observedChange) return done("no_observable_change", "no visible change after the action", false);

    const reproduced = probe.expectedAddedTexts.length > 0 && probe.expectedAddedTexts.every((t) => after.includes(t));
    if (reproduced) {
      emit({ event: "replay_reproduced", probeId: probe.id, detail: `${probe.expectedAddedTexts.length} expected texts present` });
      return { classification: "reproduced", probeId: probe.id, events, reason: "expected change reproduced", observedChange: true };
    }
    return done("product_drift", "a change occurred but not the expected one", true);
  } catch {
    return done(timedOut ? "probe_flake" : "infrastructure_failure", "unexpected error", false);
  } finally {
    clearTimeout(hardTimer);
    await browser?.close().catch(() => {});
    await proxy.close().catch(() => {});
  }
}

/**
 * Emit a replay event as an honest JSON line (mirrors the deputy agentLog `{tag,cid,...}` format). Quiet
 * in production unless INSPECTION_DEBUG — an event is written ONLY because {@link runInspectionProbe}
 * actually reached that step (a `replay_reproduced` line means the browser verified the change).
 */
export function logReplayEvent(cid: string, e: ReplayEvent): void {
  if (process.env.NODE_ENV === "production" && !process.env.INSPECTION_DEBUG) return;
  console.log(JSON.stringify({ tag: "inspection-replay", cid, ...e }));
}

export interface ReplayShadowSummary {
  ran: boolean;
  mode: ReplayMode;
  probes: number;
  byClassification: Record<string, number>;
  results: ProbeResult[];
  /** leak-safe per-probe records (ids + classification only) — safe to persist on the inspection artifact. */
  records: { probeId: string; transitionId: string; classification: string }[];
}

/**
 * SHADOW orchestrator — the pipeline may call this after an inspection to visibly re-perform the safe
 * actions Sage observed. Runs ONLY in shadow mode (a no-op otherwise), NEVER affects money or mission
 * acceptance, and returns telemetry only. Bounded to the first `maxProbes` grounded probes.
 */
export async function runReplayShadow(
  set: ObservationSetV1,
  cid: string,
  deps: ReplayDeps & { maxProbes?: number } = {},
): Promise<ReplayShadowSummary> {
  const mode = inspectionReplayMode();
  if (mode !== "shadow") return { ran: false, mode, probes: 0, byClassification: {}, results: [], records: [] };
  const probes = buildProbes(set).slice(0, deps.maxProbes ?? 6);
  const results: ProbeResult[] = [];
  const records: { probeId: string; transitionId: string; classification: string }[] = [];
  const byClassification: Record<string, number> = {};
  for (const p of probes) {
    const r = await runInspectionProbe(p, { ...deps, log: (e) => { logReplayEvent(cid, e); deps.log?.(e); } });
    results.push(r);
    records.push({ probeId: p.id, transitionId: p.sourceTransitionId, classification: r.classification }); // leak-safe: ids + code only
    byClassification[r.classification] = (byClassification[r.classification] ?? 0) + 1;
  }
  return { ran: probes.length > 0, mode, probes: probes.length, byClassification, results, records };
}

/**
 * Explicit key ALLOWLIST — an observed key is normalized to a canonical Playwright key ONLY if it is on
 * the list; an unknown key returns null and the probe is rejected. There is NO Enter fallback (that would
 * synthesize an action Sage never observed).
 */
export function allowedKey(key: string | undefined): string | null {
  if (!key) return null;
  const k = key.trim();
  if (/^(space| )$/i.test(k)) return "Space";
  if (/^enter$/i.test(k)) return "Enter";
  if (/^(escape|esc)$/i.test(k)) return "Escape";
  if (/^tab$/i.test(k)) return "Tab";
  const arrow = /^arrow(left|right|up|down)$/i.exec(k);
  if (arrow) return "Arrow" + arrow[1][0].toUpperCase() + arrow[1].slice(1).toLowerCase();
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase().length === 1 ? k : k; // single letter/digit
  return null; // unknown → not replayable
}
