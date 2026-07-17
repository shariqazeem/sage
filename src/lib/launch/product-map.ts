/**
 * Deterministic ProductMapV1 synthesis. Given the structured observations from the
 * inspector (+ optional repo artifacts + founder input), it compiles ONE normalized,
 * reproducible product map — every finding carries a real source reference and a
 * browser-confirmed flag, and the canonical digest is stable for the same inputs. No
 * LLM here: the map is deterministic evidence; the LLM reasons over it downstream.
 * Hallucination is impossible by construction — findings are derived from observations.
 */

import { norm, productMapDigest } from "./schemas";
import { aggregateVisionSignals, visionCategory, type AggregatedVision } from "./vision";
import type {
  FieldTestSummary,
  FounderLaunchInput,
  MapFinding,
  ProductMapV1,
  ProductObservation,
  RepoArtifact,
  SourceRef,
  VisionObservation,
} from "./schemas";

function pageRef(o: ProductObservation, observation: string): SourceRef {
  return { kind: "page", ref: o.url, observation };
}
function dedupeFindings(f: MapFinding[]): MapFinding[] {
  const seen = new Map<string, MapFinding>();
  for (const x of f) {
    const k = norm(x.value).toLowerCase();
    if (!k) continue;
    const prev = seen.get(k);
    if (prev) prev.sources.push(...x.sources);
    else seen.set(k, { ...x, sources: [...x.sources] });
  }
  return [...seen.values()];
}

const CATEGORY_HINTS: [RegExp, string][] = [
  [/wallet|crypto|onchain|web3|token|defi|blockchain/i, "web3 / crypto"],
  [/docs?|documentation|api reference|sdk|developer/i, "developer tool / docs"],
  [/pricing|subscribe|plans|checkout|cart|shop|store/i, "commerce / saas"],
  [/dashboard|analytics|workspace|projects?/i, "saas app"],
  [/blog|news|magazine|article/i, "content / media"],
];

function inferCategory(obs: ProductObservation[]): string {
  const blob = obs.map((o) => `${o.title} ${o.headings.join(" ")} ${o.techHints.join(" ")}`).join(" ");
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(blob)) return cat;
  return "product (uncategorized)";
}

function inferName(obs: ProductObservation[]): string {
  const landing = obs[0];
  if (!landing) return "the product";
  // og:site_name-ish: the last segment of the title after a separator is usually the brand.
  const t = landing.title;
  const brand = t.split(/\s[|–—-]\s/).map((s) => s.trim()).filter(Boolean).pop();
  return norm(brand || landing.headings[0] || new URL(landing.url).host);
}

/** Build the canonical product map. `now` stamps nothing here (digest excludes time). */
export function buildProductMap(
  observations: ProductObservation[],
  repoArtifacts: RepoArtifact[],
  founder: FounderLaunchInput,
  fieldTest?: FieldTestSummary | null,
): ProductMapV1 {
  const landing = observations[0];

  const routes = dedupeFindings(
    observations.map((o) => ({
      value: new URL(o.url).pathname || "/",
      confidence: 0.95,
      sources: [pageRef(o, o.title || "inspected page")],
      browserConfirmed: true,
    })),
  );

  const interactiveSurfaces = dedupeFindings(
    observations.flatMap((o) =>
      o.forms.map((f) => ({
        value: `${f.isAuth ? "auth" : "input"} form: ${f.label} (${f.fields.slice(0, 5).join(", ")})`,
        confidence: 0.9,
        sources: [pageRef(o, "form observed")],
        browserConfirmed: true,
      })),
    ),
  );

  const trustSurfaces = dedupeFindings(
    observations
      .filter((o) => o.authBoundary || /wallet|pay|billing|checkout|password|account/i.test(o.title + o.headings.join(" ")))
      .map((o) => ({
        value: `${new URL(o.url).pathname} — ${o.authBoundary ? "authentication boundary" : "trust-sensitive surface"}`,
        confidence: o.authBoundary ? 0.9 : 0.6,
        sources: [pageRef(o, o.authBoundary ? "auth form / password field" : "trust keywords in copy")],
        browserConfirmed: true,
      })),
  );

  const claimRisks = dedupeFindings(
    observations.flatMap((o) =>
      o.claims
        .filter((c) => /\b(secure|fast|instant|guarantee|best|no code|free|unlimited|private|automatically|in seconds|24\/7)\b/i.test(c))
        .map((c) => ({
          value: c,
          confidence: 0.7,
          sources: [pageRef(o, "marketing claim")],
          browserConfirmed: true,
        })),
    ),
  ).slice(0, 8);

  const observedStates = dedupeFindings(
    observations.flatMap((o) =>
      o.states.map((s) => ({ value: `${s} state on ${new URL(o.url).pathname}`, confidence: 0.6, sources: [pageRef(o, `${s} copy`)], browserConfirmed: true })),
    ),
  );

  // primary journey: landing → first onboarding/pricing/app surface, ordered by discovery.
  const journeyOrder = /sign-?up|signup|register|onboard|get-?started|start|pricing|plans|app|dashboard|checkout/i;
  const primaryJourney = dedupeFindings(
    observations
      .filter((o, i) => i === 0 || journeyOrder.test(o.url))
      .slice(0, 5)
      .map((o, i) => ({
        value: `${i + 1}. ${i === 0 ? "Arrive on" : "Continue to"} ${new URL(o.url).pathname} — ${o.ctas[0] ?? o.title}`,
        confidence: 0.75,
        sources: [pageRef(o, o.ctas.slice(0, 3).join(" / ") || "page in journey")],
        browserConfirmed: true,
      })),
  );

  const browserConfirmed = routes.map((r) => ({ ...r }));
  const repoOnlyCapabilities = dedupeFindings(
    repoArtifacts.map((a) => ({
      value: a.observation,
      confidence: 0.5,
      sources: [{ kind: "repo" as const, ref: a.path, observation: a.kind }],
      browserConfirmed: false,
    })),
  );

  const targetUserHypotheses: MapFinding[] = landing
    ? [
        {
          value: `Inferred from copy: ${(landing.claims[0] ?? landing.title).slice(0, 120)}`,
          confidence: 0.5,
          sources: [pageRef(landing, "landing copy")],
          browserConfirmed: true,
        },
      ]
    : [];

  const limitations: string[] = [];
  const openQuestions: string[] = [];
  if (observations.length === 0) {
    openQuestions.push("Sage could not inspect any page — is the product URL public and reachable over HTTPS?");
  }
  if (observations.length > 0 && observations.length < 3) {
    limitations.push("Only a few pages were reachable, so the map is partial.");
  }
  if (repoArtifacts.length === 0 && founder.repoUrl) {
    limitations.push("The repository could not be inspected; coverage is web-only.");
  }
  if (!observations.some((o) => journeyOrder.test(o.url)) && observations.length > 0) {
    openQuestions.push("Sage did not find an obvious signup/onboarding surface — where should a new user start?");
  }

  const base: Omit<ProductMapV1, "digest"> = {
    productName: inferName(observations),
    category: inferCategory(observations),
    valueProp: norm(landing?.claims[0] ?? landing?.title ?? "").slice(0, 200) || "(no clear value proposition observed)",
    targetUserHypotheses,
    founderTargetUsers: norm(founder.targetUsers).slice(0, 400),
    primaryJourney,
    routes,
    interactiveSurfaces,
    trustSurfaces,
    claimRisks,
    observedStates,
    repoOnlyCapabilities,
    browserConfirmed,
    limitations,
    openQuestions,
    pagesInspected: observations.length,
    repoFilesInspected: repoArtifacts.length,
  };
  // The digest is computed over `base` ONLY — the field test is attached AFTER, so it never
  // shifts the map digest (or any downstream plan hash). Off/failed field test → no key at all,
  // leaving the serialized map byte-identical to today.
  const map: ProductMapV1 = { ...base, digest: productMapDigest(base) };
  if (fieldTest && fieldTest.ran && (fieldTest.pages.length > 0 || fieldTest.states.length > 0)) map.fieldTest = fieldTest;
  // P14 — enrich the map's UNDERSTANDING from what a vision model saw in the state screenshots. Applied
  // AFTER the digest, so the canonical digest stays a stable hash of the deterministic static evidence
  // (vision is non-deterministic). No visionObservations → this is a no-op → the map is byte-identical.
  // Vision only ever runs in interactive mode (states>1), so this only touches thin visual products —
  // exactly the ones static text categorization fails on (yara.garden → "product (uncategorized)").
  if (fieldTest?.visionObservations && fieldTest.visionObservations.length > 0) {
    applyVisionUnderstanding(map, observations, fieldTest.visionObservations);
  }
  return map;
}

/** A short product name derived from vision: the shortest title segment (or host brand) that the
 *  vision model actually SAW on screen. yara.garden: title "Yara — a gentle world to heal" → "Yara". */
function visionNameFrom(landing: ProductObservation | undefined, agg: AggregatedVision): string | null {
  if (!landing) return null;
  const visText = agg.visibleText.join(" · ").toLowerCase();
  let hostBrand = "";
  try {
    hostBrand = new URL(landing.url).host.replace(/^www\./, "").split(".")[0].toLowerCase();
  } catch {
    /* no host */
  }
  const segs = landing.title.split(/\s[|–—:·-]\s/).map((s) => norm(s)).filter(Boolean);
  for (const seg of segs) {
    const low = seg.toLowerCase();
    if (seg.split(/\s+/).length <= 2 && (visText.includes(low) || (hostBrand && low.includes(hostBrand)))) return seg;
  }
  if (hostBrand && visText.includes(hostBrand)) return hostBrand.charAt(0).toUpperCase() + hostBrand.slice(1);
  return null;
}

/** Override category/name + seed audience/value-prop from vision — only for products Sage LOOKED at. */
function applyVisionUnderstanding(map: ProductMapV1, observations: ProductObservation[], visionObs: VisionObservation[]): void {
  const agg = aggregateVisionSignals(visionObs);
  const landing = observations[0];

  const cat = visionCategory(agg);
  if (cat) map.category = cat;

  const name = visionNameFrom(landing, agg);
  if (name) map.productName = name;

  if (agg.audienceSignals.length > 0 && landing) {
    map.targetUserHypotheses = [
      {
        value: `Seen on screen: ${agg.audienceSignals.slice(0, 3).join(", ")}`,
        confidence: 0.55,
        sources: [pageRef(landing, "vision observation of the product")],
        browserConfirmed: true,
      },
      ...map.targetUserHypotheses,
    ];
  }

  // seed the value prop from what Sage actually saw only when the static one is empty/placeholder.
  if ((!map.valueProp || /^\(no clear/.test(map.valueProp)) && agg.sceneDescriptions.length > 0) {
    map.valueProp = agg.sceneDescriptions[0].slice(0, 200);
  }
}

/** The set of every URL/host/repo-path known from the map — the mission-validation scope. */
export function scopeFromObservations(observations: ProductObservation[], repoArtifacts: RepoArtifact[]) {
  const knownUrls = new Set<string>();
  const hosts = new Set<string>();
  for (const o of observations) {
    knownUrls.add(o.url);
    try {
      const u = new URL(o.url);
      hosts.add(u.host.toLowerCase());
      knownUrls.add(`${u.origin}/`);
      for (const l of o.links) {
        try {
          const lu = new URL(l, o.url);
          if (lu.host.toLowerCase() === u.host.toLowerCase()) knownUrls.add(lu.toString());
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }
  return { knownUrls, hosts, repoPaths: new Set(repoArtifacts.map((a) => a.path)) };
}
