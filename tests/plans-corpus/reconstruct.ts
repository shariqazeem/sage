/**
 * Read a stored inspection job back into the inputs today's deterministic code takes (22 Nov 2026).
 *
 * A stored job keeps the map, the field test and the plan, but NOT the static read (`ProductObservation[]`).
 * So the static pages are rebuilt as far as the map remembers them: one per inspected route, with the title,
 * the calls to action and the claims the map kept, plus the exact visible texts of the observation set. That
 * makes two of the gate's checks APPROXIMATE on stored data, and every measure built on this file says so:
 *   - an anchor quoted from a static page's body may be missing from the rebuilt corpus;
 *   - a target that was only ever a same-site LINK on a static page may be missing from the rebuilt scope.
 * Every check that reads only the mission's own words (safety, injection, evidence Sage can read, presence,
 * volatile, the kind's proof rule) is exact.
 *
 * No private data lives here: this file only knows the SHAPE of a stored job.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import type { CandidateMission, FieldTestSummary, MapFinding, ProductMapV1, ProductObservation } from "@/lib/launch/schemas";
import { scopeFromObservations } from "@/lib/launch/product-map";
import { buildObservationCorpus, type ValidationScope } from "@/lib/launch/validate-mission";
import { detectProductKind, type ProductKindRecord } from "@/lib/launch/product-kind";

export interface StoredMission {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceRequirements: string[];
  whyItMatters?: string;
  sources?: CandidateMission["sources"];
  riskCategory?: CandidateMission["riskCategory"];
  priority?: CandidateMission["priority"];
  effortMinutes?: number;
  rewardWeight?: number;
  maxCompletions?: string | number;
  verificationMethod?: string;
  anchors?: string[];
  verifiabilityClass?: "url-verifiable" | "observation-based";
  conditions?: string[];
  disallowed?: string[];
  criterionEvidence?: { criterionIndex: number; keySources: string[] }[] | null;
}

export interface StoredJob {
  id: string;
  status: "ready" | "needs_input" | "failed";
  public_campaign_id: string | null;
  product_url: string;
  goal: string | null;
  target_users: string | null;
  total_budget_base: string | number | null;
  token_decimals: number | null;
  pages_inspected: number | null;
  model: string | null;
  provider: string | null;
  prompt_version: string | null;
  failure_reason: string | null;
  created_at: number;
  result: {
    stage?: string;
    reason?: string | null;
    map?: ProductMapV1 | null;
    brain?: {
      ok?: boolean;
      reason?: string | null;
      reasonDetail?: string;
      candidates?: StoredMission[];
      accepted?: StoredMission[];
      critiques?: { missionKey: string; decision: string }[];
      reports?: { ok: boolean; missionKey: string; issues: { code: string; field: string; detail: string }[] }[];
    } | null;
    plan?: { missions?: StoredMission[]; modelVersion?: string; promptVersion?: string } | null;
    questions?: string[];
    trail?: { stage: string; at: number }[];
    canary?: { status?: string; reason?: string; planSource?: string } | null;
  } | null;
}

/** One JSON line per job, gzipped or plain. */
export function readJobs(path: string): StoredJob[] {
  const raw = readFileSync(path);
  const text = path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const j = JSON.parse(l) as StoredJob;
      if (typeof j.result === "string") j.result = JSON.parse(j.result as unknown as string) as StoredJob["result"];
      return j;
    });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const findings = (v: unknown): MapFinding[] => (Array.isArray(v) ? (v as MapFinding[]) : []);

/**
 * The static pages, as far as the map remembers them. Never the real read: titles, calls to action and claims
 * come from the map's findings, body text only from the observation set's exact visible texts.
 */
export function pseudoObservations(map: ProductMapV1 | null | undefined): ProductObservation[] {
  if (!map) return [];
  const byUrl = new Map<string, ProductObservation>();
  const page = (url: string): ProductObservation | null => {
    try {
      new URL(url);
    } catch {
      return null;
    }
    let o = byUrl.get(url);
    if (!o) {
      o = { url, status: 200, title: "", headings: [], claims: [], ctas: [], forms: [], links: [], authBoundary: false, techHints: [], states: [], landmarks: [], snippets: [], inspectedAt: 0, contentSha256: "" };
      byUrl.set(url, o);
    }
    return o;
  };
  for (const r of findings(map.routes)) {
    for (const s of r.sources ?? []) {
      if (s.kind !== "page") continue;
      const o = page(s.ref);
      if (o && !o.title && s.observation && s.observation !== "inspected page") o.title = s.observation;
    }
  }
  for (const j of findings(map.primaryJourney)) {
    for (const s of j.sources ?? []) {
      if (s.kind !== "page") continue;
      const o = page(s.ref);
      if (o && s.observation && s.observation !== "page in journey") for (const c of s.observation.split(" / ")) if (c.trim()) o.ctas.push(c.trim());
    }
  }
  for (const c of findings(map.claimRisks)) {
    for (const s of c.sources ?? []) {
      if (s.kind !== "page") continue;
      page(s.ref)?.claims.push(c.value);
    }
  }
  // every other finding that cites a page keeps that page in scope
  for (const group of [map.interactiveSurfaces, map.trustSurfaces, map.observedStates, map.browserConfirmed, map.targetUserHypotheses]) {
    for (const f of findings(group)) for (const s of f.sources ?? []) if (s.kind === "page") page(s.ref);
  }
  // exact visible texts Sage captured, page by page (static facts and the browser's alike)
  for (const f of map.observations?.facts ?? []) {
    const o = page(str(f.pageUrl));
    if (!o) continue;
    for (const t of f.visibleTexts ?? []) if (t) o.snippets.push(t);
    if (f.elementName) o.snippets.push(f.elementName);
  }
  const first = byUrl.values().next().value as ProductObservation | undefined;
  if (first && str(map.valueProp)) first.snippets.push(map.valueProp);
  return [...byUrl.values()];
}

export interface Rebuilt {
  map: ProductMapV1;
  fieldTest: FieldTestSummary | null;
  observations: ProductObservation[];
  scope: ValidationScope;
  corpus: string;
  /** the kind today's detector gives this address and what was seen */
  kind: ProductKindRecord;
}

/** Everything today's gate needs, rebuilt from one stored job. Null when the job kept no map. */
export function rebuild(job: StoredJob): Rebuilt | null {
  const stored = job.result?.map ?? null;
  if (!stored) return null;
  const fieldTest = (stored.fieldTest ?? null) as FieldTestSummary | null;
  const observations = pseudoObservations(stored);
  const kind = detectProductKind({ url: job.product_url, observations, fieldTest });
  // as the pipeline writes it: the kind rides on the map, absent for an ordinary website
  const map: ProductMapV1 = { ...stored, pagesInspected: stored.pagesInspected ?? 0, limitations: stored.limitations ?? [], openQuestions: stored.openQuestions ?? [] };
  if (kind.kind !== "website") map.productKind = kind;
  else delete map.productKind;
  const scope = scopeFromObservations(observations, [], fieldTest);
  // the pasted address itself is always in scope: Sage opened it
  try {
    const u = new URL(job.product_url);
    scope.knownUrls.add(u.toString());
    scope.knownUrls.add(`${u.origin}/`);
    scope.hosts.add(u.host.toLowerCase());
  } catch {
    /* an unreadable address stays out */
  }
  const corpus = buildObservationCorpus(observations, fieldTest);
  return { map, fieldTest, observations, scope, corpus, kind };
}

/** A stored plan mission as the gate reads a candidate. Amounts are never read: the weight is a placeholder. */
export function asCandidate(m: StoredMission): CandidateMission {
  return {
    missionKey: str(m.missionKey),
    title: str(m.title),
    objective: str(m.objective),
    instructions: str(m.instructions),
    targetSurface: str(m.targetSurface),
    criteria: Array.isArray(m.criteria) ? m.criteria.map(str) : [],
    evidenceRequirements: Array.isArray(m.evidenceRequirements) ? m.evidenceRequirements.map(str) : [],
    whyItMatters: str(m.whyItMatters) || "stored mission",
    sources: Array.isArray(m.sources) ? m.sources : [],
    priority: m.priority ?? "medium",
    riskCategory: m.riskCategory ?? "critical_journey",
    effortMinutes: typeof m.effortMinutes === "number" && m.effortMinutes > 0 ? m.effortMinutes : 5,
    conditions: m.conditions ?? [],
    rewardWeight: typeof m.rewardWeight === "number" ? Math.min(10, Math.max(1, m.rewardWeight)) : 5,
    maxCompletions: Math.max(1, Number(m.maxCompletions ?? 1) || 1),
    verificationMethod: str(m.verificationMethod) || "stored mission",
    confidence: 0.8,
    assumptions: [],
    disallowed: m.disallowed ?? [],
    anchors: Array.isArray(m.anchors) ? m.anchors.map(str) : [],
  };
}

/** Which slice a job belongs to, by its prompt version: the era decides how much weight a number deserves. */
export function sliceOf(job: Pick<StoredJob, "prompt_version">): "direct" | "mb-v1" | "mb-v2" | "mb-v3" | "mb-v4.x" | "none" {
  const v = job.prompt_version ?? "";
  if (v.startsWith("direct")) return "direct";
  if (v === "mb-v1") return "mb-v1";
  if (v === "mb-v2") return "mb-v2";
  if (v.startsWith("mb-v3")) return "mb-v3";
  if (v.startsWith("mb-v4")) return "mb-v4.x";
  return "none";
}

/** The product, as a host with no path: enough to count products, and never written into the repo. */
export function hostOfJob(job: Pick<StoredJob, "product_url">): string {
  try {
    return new URL(job.product_url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "(unreadable)";
  }
}
