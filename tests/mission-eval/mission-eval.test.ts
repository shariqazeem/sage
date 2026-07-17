import { describe, expect, it } from "vitest";
import {
  buildObservationCorpus,
  classifyVerifiability,
  observationScore,
  SUFFICIENCY_THRESHOLD,
  validatePlanMissions,
} from "@/lib/launch/validate-mission";
import { scopeFromObservations } from "@/lib/launch/product-map";
import type { CandidateMission, FieldTestSummary, ProductObservation } from "@/lib/launch/schemas";

/**
 * MISSION EVAL HARNESS (P15.6) — golden, deterministic assertions over representative product
 * shapes, so "world-class" is measured, not felt. Each fixture is a canned OBSERVATION SET (what
 * Sage would see); we assert the deterministic gates behave correctly REGARDLESS of any model:
 *   - the anchor gate NEVER lets an un-observed claim (a "Zoom Control") through (anti-hallucination);
 *   - the sufficiency score is above threshold for rich products and below it for a near-empty one;
 *   - the verifiability classifier splits url-verifiable vs observation-based honestly.
 * The live model A/B lives in scripts/mission-eval.mjs; this file is the always-green floor.
 */

function obs(url: string, over: Partial<ProductObservation> = {}): ProductObservation {
  return {
    url, status: 200, title: "", headings: [], claims: [], ctas: [], forms: [], links: [],
    authBoundary: false, techHints: [], states: [], landmarks: [], snippets: [],
    inspectedAt: 0, contentSha256: "a".repeat(64), ...over,
  };
}

function mission(over: Partial<CandidateMission>): CandidateMission {
  return {
    missionKey: "m", title: "T", objective: "O", instructions: "1. do a thing and observe the result",
    targetSurface: "", criteria: [], evidenceRequirements: ["a written account"], whyItMatters: "why",
    sources: [], priority: "medium", riskCategory: "critical_journey", effortMinutes: 15,
    conditions: [], rewardWeight: 5, maxCompletions: 3, verificationMethod: "judge the account",
    confidence: 0.7, assumptions: [], disallowed: [], anchors: [], ...over,
  };
}

/* ───────────────────────────── the fixtures ──────────────────────────────── */

// GAME / interactive experience (the yara.garden shape): thin DOM, rich field test + vision.
const GAME = {
  observations: [obs("https://game.example/", { title: "Yara — a gentle world to heal", ctas: ["make a wish at the wishing tree"] })],
  fieldTest: {
    ran: true, startUrl: "https://game.example/", mode: "interactive", pages: [],
    states: [
      { trigger: "initial load", screenshot: null, visibleTextExcerpt: "A GENTLE WORLD TO HEAL", notableElements: [], pixelDeltaPct: 100, url: "https://game.example/" },
      { trigger: "explored '+'", screenshot: null, visibleTextExcerpt: "Oh — hello. I felt you arrive. I'm Yara.", notableElements: [{ tag: "button", text: "make a wish", role: "button" }], pixelDeltaPct: 30, url: "https://game.example/" },
    ],
    classification: "Interactive app detected · 2 states explored", limitation: null, durationMs: 1,
    visionObservations: [
      { stateIndex: 0, trigger: "initial load", sceneDescription: "an anime valley at sunset with glowing lanterns", visibleText: ["Yara", "breathe", "tap to step inside"], uiElements: [{ label: "make a wish", kind: "button" }], productTypeSignals: ["interactive game", "anime art"], audienceSignals: ["casual gamers"], qualityIssues: [] },
    ],
  } as FieldTestSummary,
};

// STATIC LANDING: one text-rich marketing page, no field test.
const LANDING = {
  observations: [obs("https://land.example/", {
    title: "Acme — ship faster", headings: ["Ship faster", "Pricing", "Trusted by teams"],
    claims: ["Deploy in seconds", "Free tier forever", "SOC2 compliant"],
    ctas: ["Start free", "See pricing"], links: ["https://land.example/pricing", "https://land.example/docs"],
    snippets: [
      "Acme deploys your app to production in seconds with zero configuration and automatic rollbacks.",
      "Start on the free tier forever — upgrade only when your team grows. No credit card required.",
      "Trusted by thousands of engineering teams to ship faster, with SOC2-compliant infrastructure.",
    ],
  })],
  fieldTest: undefined,
};

// MULTI-PAGE SaaS: several content pages.
const SAAS = {
  observations: [
    obs("https://saas.example/", { title: "Plausible — privacy analytics", headings: ["Simple analytics"], claims: ["No cookies", "Lightweight script"], ctas: ["Start free trial"], links: ["https://saas.example/pricing", "https://saas.example/docs"], snippets: ["Plausible is a lightweight, open-source, privacy-friendly alternative to Google Analytics, with no cookies and full GDPR compliance."] }),
    obs("https://saas.example/pricing", { title: "Pricing — Plausible", headings: ["Pricing"], claims: ["Starts at $9/mo"], ctas: ["Choose plan"], snippets: ["Simple, transparent pricing that scales with your pageviews. Start with a 30-day free trial, no card required."] }),
    obs("https://saas.example/docs", { title: "Docs — add your website", headings: ["Add your website"], snippets: ["Paste the Plausible script tag into the <head> of your site, then verify traffic appears on your dashboard within minutes."] }),
  ],
  fieldTest: undefined,
};

// THIN: a login wall — one page, an auth form, almost no readable content.
const THIN = {
  observations: [obs("https://thin.example/", { title: "Login", forms: [{ label: "Sign in", fields: ["email", "password"], isAuth: true }], authBoundary: true })],
  fieldTest: undefined,
};

const richness = (f: { observations: ProductObservation[]; fieldTest?: FieldTestSummary }) => {
  const corpus = buildObservationCorpus(f.observations, f.fieldTest);
  const ft = f.fieldTest;
  const els = new Set<string>();
  for (const s of ft?.states ?? []) for (const e of s.notableElements ?? []) els.add(e.text.toLowerCase());
  for (const v of ft?.visionObservations ?? []) for (const e of v.uiElements ?? []) els.add(e.label.toLowerCase());
  for (const o of f.observations) for (const c of o.ctas) els.add(c.toLowerCase());
  return observationScore({
    states: ft?.states?.length ?? 0,
    pages: f.observations.length,
    vision: ft?.visionObservations?.length ?? 0,
    distinctElements: els.size,
    textLen: corpus.length,
  });
};

/* ─────────────────── golden: the anti-hallucination guarantee ─────────────── */

describe("mission-eval · anchor gate never lets an un-observed claim through", () => {
  const corpus = buildObservationCorpus(GAME.observations, GAME.fieldTest);
  const scope = scopeFromObservations(GAME.observations, []);

  it("the game corpus contains what was seen, and NOT the classic hallucination", () => {
    expect(corpus).toContain("make a wish");
    expect(corpus).toContain("i felt you arrive");
    expect(corpus).toContain("breathe");
    expect(corpus).not.toContain("zoom control");
  });

  it("a mixed batch: the Zoom-Control hallucination + a presence check are rejected; the anchored mission survives", () => {
    const batch: CandidateMission[] = [
      mission({ missionKey: "zoom", title: "Validate Zoom Control Functionality", objective: "Confirm the zoom control works", anchors: ["Zoom Control"], targetSurface: "https://game.example/", criteria: ["the zoom control zooms"], sources: [{ kind: "page", ref: "https://game.example/", observation: "x" }] }),
      mission({ missionKey: "presence", title: "Verify the wish button exists", objective: "Confirm the make a wish button is present in the DOM", anchors: ["make a wish"], targetSurface: "https://game.example/", criteria: ["the 'make a wish' element is present in the DOM"], sources: [{ kind: "page", ref: "https://game.example/", observation: "x" }] }),
      mission({ missionKey: "real", title: "Experience the arrival dialogue", objective: "Confirm the arrival dialogue appears after the first interaction", anchors: ["Oh — hello. I felt you arrive", "make a wish"], targetSurface: "https://game.example/", criteria: ["After interacting, the text 'Oh — hello. I felt you arrive' appears on screen"], sources: [{ kind: "page", ref: "https://game.example/", observation: "narrative observed" }] }),
    ];
    const reports = validatePlanMissions(batch, scope, corpus);
    const byKey = Object.fromEntries(reports.map((r) => [r.missionKey, r.issues.map((i) => i.code)]));
    expect(byKey.zoom).toContain("unanchored_claim"); // NEVER passes the corpus check
    expect(byKey.presence).toContain("worthless_presence_check");
    expect(byKey.real).toEqual([]); // anchored + action→outcome survives
  });
});

/* ─────────────────── golden: sufficiency thresholds ───────────────────────── */

describe("mission-eval · sufficiency separates rich products from near-empty ones", () => {
  it("rich products (game, landing, SaaS) score at or above threshold → they proceed to the architect", () => {
    expect(richness(GAME)).toBeGreaterThanOrEqual(SUFFICIENCY_THRESHOLD);
    expect(richness(LANDING)).toBeGreaterThanOrEqual(SUFFICIENCY_THRESHOLD);
    expect(richness(SAAS)).toBeGreaterThanOrEqual(SUFFICIENCY_THRESHOLD);
  });

  it("a login wall scores below threshold → needs_input, never a confabulated plan", () => {
    expect(richness(THIN)).toBeLessThan(SUFFICIENCY_THRESHOLD);
  });
});

/* ─────────────────── golden: verifiability split is honest ────────────────── */

describe("mission-eval · verifiability classification", () => {
  it("a landing mission (reach a page, find specific text) is url-verifiable", () => {
    expect(
      classifyVerifiability({
        objective: "Confirm the pricing link leads to a page stating the free tier",
        criteria: ["The 'See pricing' link leads to the pricing page", "The reached page contains the text 'Free tier forever'"],
        evidenceRequirements: ["The URL reached and the quoted text"],
      }),
    ).toBe("url-verifiable");
  });

  it("a game mission (an on-screen behaviour after an action) is observation-based", () => {
    expect(
      classifyVerifiability({
        objective: "Confirm the arrival dialogue appears after the first interaction",
        criteria: ["After interacting, the text 'Oh — hello. I felt you arrive' appears on screen"],
        evidenceRequirements: ["A written account of what appeared and when"],
      }),
    ).toBe("observation-based");
  });
});
