import { describe, expect, it } from "vitest";
import { buildProductMap, fieldTestExplored, hasUsableInspection, scopeFromObservations } from "./product-map";
import type { FieldTestSummary, FounderLaunchInput, ProductObservation, VisionObservation } from "./schemas";

/**
 * The product map is deterministic evidence: same inputs → same normalized map + digest;
 * every finding cites a real source; thin evidence yields needs_input rather than
 * invention; the derived validation scope contains exactly the observed URLs/hosts.
 */

function obs(url: string, over: Partial<ProductObservation> = {}): ProductObservation {
  return {
    url, status: 200, title: "Acme — ship faster", headings: ["Ship faster", "Pricing"],
    claims: ["The fastest way to deploy", "Secure by default"], ctas: ["Get started", "Sign up"],
    forms: [{ label: "Sign up", fields: ["email", "password"], isAuth: true }],
    links: [`${new URL(url).origin}/pricing`, `${new URL(url).origin}/docs`],
    authBoundary: true, techHints: ["Next.js"], states: ["loading"], landmarks: ["nav", "main"],
    snippets: ["Deploy in seconds"], inspectedAt: 0, contentSha256: "a".repeat(64), ...over,
  };
}
const founder: FounderLaunchInput = {
  productUrl: "https://acme.example", goal: "learn onboarding", targetUsers: "developers",
  totalBudgetBase: BigInt(5_000_000), tokenDecimals: 6,
};

describe("buildProductMap — deterministic, sourced, honest", () => {
  it("is deterministic — identical observations produce an identical digest", () => {
    const o = [obs("https://acme.example/"), obs("https://acme.example/pricing", { title: "Pricing" })];
    const a = buildProductMap(o, [], founder);
    const b = buildProductMap(o, [], founder);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("every route finding cites a real inspected source", () => {
    const map = buildProductMap([obs("https://acme.example/"), obs("https://acme.example/pricing")], [], founder);
    expect(map.routes.length).toBeGreaterThan(0);
    for (const r of map.routes) {
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.browserConfirmed).toBe(true);
    }
    expect(map.trustSurfaces.length).toBeGreaterThan(0); // auth boundary observed
  });

  it("no inspected pages → open questions, never invention", () => {
    const map = buildProductMap([], [], founder);
    expect(map.pagesInspected).toBe(0);
    expect(map.openQuestions.length).toBeGreaterThan(0);
    expect(map.routes).toHaveLength(0);
    expect(map.valueProp).toMatch(/no clear value proposition/i);
  });

  it("the digest changes when the observed value proposition changes", () => {
    const a = buildProductMap([obs("https://acme.example/", { claims: ["Fast deploys"] })], [], founder);
    const b = buildProductMap([obs("https://acme.example/", { claims: ["Slow but steady"] })], [], founder);
    expect(a.digest).not.toBe(b.digest);
  });

  it("scopeFromObservations contains the inspected URLs + hosts (for mission validation)", () => {
    const scope = scopeFromObservations([obs("https://acme.example/"), obs("https://acme.example/pricing")], []);
    expect(scope.hosts.has("acme.example")).toBe(true);
    expect(scope.knownUrls.has("https://acme.example/")).toBe(true);
    // discovered same-origin links are in scope too (so a mission can target them).
    expect([...scope.knownUrls].some((u) => u.includes("/pricing"))).toBe(true);
  });
});

/* ─────────────────────────── P14 — vision enrichment ─────────────────────── */

const yaraObs = (): ProductObservation =>
  obs("https://yara.example/", {
    title: "Yara — a gentle world to heal",
    headings: [],
    claims: [],
    ctas: ["·"],
    forms: [],
    techHints: [],
    authBoundary: false,
    states: [],
  });

function fieldTest(vision: VisionObservation[] | undefined): FieldTestSummary {
  const base: FieldTestSummary = {
    ran: true,
    startUrl: "https://yara.example/",
    mode: "interactive",
    pages: [],
    states: [
      { trigger: "initial load", screenshot: "/api/field-tests/x/0", visibleTextExcerpt: "Yara", notableElements: [], pixelDeltaPct: 100, url: "https://yara.example/" },
      { trigger: "explored '+'", screenshot: "/api/field-tests/x/1", visibleTextExcerpt: "Yara", notableElements: [], pixelDeltaPct: 20, url: "https://yara.example/" },
    ],
    classification: "Interactive app detected · 2 states explored",
    limitation: null,
    durationMs: 1,
  };
  return vision ? { ...base, visionObservations: vision } : base;
}

const yaraVision: VisionObservation[] = [
  {
    stateIndex: 0, trigger: "initial load",
    sceneDescription: "An anime-styled ambient world with drifting particles",
    visibleText: ["Yara", "make a wish"], uiElements: [{ label: "+", kind: "button" }],
    productTypeSignals: ["interactive game", "anime art"],
    audienceSignals: ["casual players seeking calm"], qualityIssues: [],
  },
];

describe("buildProductMap — P14 vision enrichment", () => {
  it("is byte-identical in its understanding when the field test carries NO vision observations", () => {
    const noFt = buildProductMap([yaraObs()], [], founder);
    const ftNoVision = buildProductMap([yaraObs()], [], founder, fieldTest(undefined));
    // attaching a field test (without vision) must change NO understanding field.
    expect(ftNoVision.productName).toBe(noFt.productName);
    expect(ftNoVision.category).toBe(noFt.category);
    expect(ftNoVision.valueProp).toBe(noFt.valueProp);
    expect(ftNoVision.targetUserHypotheses).toEqual(noFt.targetUserHypotheses);
    expect(ftNoVision.digest).toBe(noFt.digest);
    expect(ftNoVision.category).toBe("product (uncategorized)"); // the un-enriched baseline
  });

  it("enriches category, name, and audience from vision when present", () => {
    const map = buildProductMap([yaraObs()], [], founder, fieldTest(yaraVision));
    expect(map.category).toMatch(/interactive game/i);
    expect(map.category).toMatch(/anime-styled/i);
    expect(map.productName).toBe("Yara"); // from the title's short segment, seen on screen
    expect(map.targetUserHypotheses[0].value).toMatch(/seen on screen:.*casual players/i);
  });

  it("keeps the canonical digest stable — vision is applied AFTER the digest", () => {
    const withVision = buildProductMap([yaraObs()], [], founder, fieldTest(yaraVision));
    const withoutVision = buildProductMap([yaraObs()], [], founder, fieldTest(undefined));
    expect(withVision.digest).toBe(withoutVision.digest);
  });
});

/* ───────────────── P-GEN — bot-walled / SPA rescue via the field test ────────────────── */

describe("buildProductMap — reached-but-thin (bot-walled store / client-rendered SPA)", () => {
  it("does NOT ask 'couldn't read any page' when static obs are empty but the browser DID explore", () => {
    // A WAF-guarded store or a JS-rendered SPA returns ZERO server-rendered observations to our
    // read-only UA, but the real headless browser reaches it. That is an INSPECTED product — the
    // mission corpus is built from the field test — so it must NOT surface a "couldn't inspect" ask.
    const rescued = buildProductMap([], [], founder, fieldTest(yaraVision)); // 2 states + vision
    expect(rescued.pagesInspected).toBe(0); // static crawl saw nothing…
    expect(rescued.fieldTest?.states?.length ?? 0).toBeGreaterThan(0); // …but the browser did
    expect(rescued.openQuestions.some((q) => /couldn't read|could not inspect/i.test(q))).toBe(false);
  });

  it("still asks when NEITHER the static crawl NOR the browser saw anything (dead / hard-blocked URL)", () => {
    const nothing = buildProductMap([], [], founder); // no field test at all
    expect(nothing.openQuestions.some((q) => /couldn't read|could not inspect|reachable|blocking/i.test(q))).toBe(true);
  });
});

/* ───────────────── P-GEN — non-English categorization (verification c) ────────────────── */

describe("buildProductMap — multilingual category hints", () => {
  it("categorizes a French commerce page via non-English hints, not 'uncategorized'", () => {
    // Real regression: about.gitlab.com/fr-fr → the English-only CATEGORY_HINTS stranded it at
    // "uncategorized". "Tarifs"/"abonnement" must now resolve to commerce / saas.
    const fr = obs("https://exemple.fr/", { title: "Tarifs et abonnement", headings: ["Nos tarifs", "Commencer"], claims: ["Essai gratuit"] });
    expect(buildProductMap([fr], [], founder).category).toBe("commerce / saas");
  });

  it("categorizes a German developer page via non-English hints", () => {
    const de = obs("https://beispiel.de/", { title: "Entwickler Dokumentation", headings: ["API"], claims: [] });
    expect(buildProductMap([de], [], founder).category).toBe("developer tool / docs");
  });
});

/* ───────────── P-GEN hardening — one shared "is this inspectable?" predicate ───────────── */

describe("hasUsableInspection / fieldTestExplored (single source of truth)", () => {
  const ft = (over: Partial<FieldTestSummary>): FieldTestSummary => ({
    ran: true, startUrl: "https://x/", mode: "static", pages: [], states: [], classification: "", limitation: null, durationMs: 1, ...over,
  });
  it("fieldTestExplored: true only when the browser saw a page or a state", () => {
    expect(fieldTestExplored(null)).toBe(false);
    expect(fieldTestExplored(ft({ ran: false, pages: [{}] as never }))).toBe(false); // didn't run
    expect(fieldTestExplored(ft({ pages: [], states: [] }))).toBe(false); // ran, saw nothing
    expect(fieldTestExplored(ft({ pages: [{}] as never }))).toBe(true);
    expect(fieldTestExplored(ft({ states: [{}] as never }))).toBe(true);
  });
  it("hasUsableInspection: static pages OR a browser exploration — the exact gate the pipeline+brain share", () => {
    expect(hasUsableInspection({ pagesInspected: 2, fieldTest: undefined })).toBe(true); // static only
    expect(hasUsableInspection({ pagesInspected: 0, fieldTest: ft({ states: [{}] as never }) })).toBe(true); // bot-walled rescued
    expect(hasUsableInspection({ pagesInspected: 0, fieldTest: undefined })).toBe(false); // dead / hard-blocked
    expect(hasUsableInspection({ pagesInspected: 0, fieldTest: ft({ pages: [], states: [] }) })).toBe(false); // browser saw nothing
  });
});
