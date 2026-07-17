/**
 * Sage Mission Brain — the canonical, pure data model for founder-launch inspection
 * and product-specific mission generation. No I/O, no `server-only`: every type here
 * is validated + digested deterministically (viem keccak only), so the whole pipeline
 * unit-tests directly and the digests are reproducible.
 *
 * The chain of custody is: founder input + inspected observations → ProductMapV1 →
 * candidate missions (LLM) → critiqued + deterministically-validated missions →
 * exact budget allocation → MissionPlanV1 → (on approval) canonical MissionSpecV1 +
 * CampaignVaultV2 hashes. Every founder-visible finding cites a real source.
 */

import { type Hex, encodeAbiParameters, keccak256, stringToHex } from "viem";

/* ─────────────────────────────────────────────────── founder input ──────── */

export interface FounderLaunchInput {
  /** the public HTTPS product URL to inspect. */
  productUrl: string;
  /** an optional public GitHub repository URL (read-only, bounded). */
  repoUrl?: string | null;
  /** what the founder is launching or trying to learn (free text). */
  goal: string;
  /** who the founder believes the target users are (free text). */
  targetUsers: string;
  /** total testing budget in token base units (6dp USDC). */
  totalBudgetBase: bigint;
  /** the token's decimals (6 for USDC). */
  tokenDecimals: number;
}

/* ──────────────────────────────────────────── inspected observation ─────── */

export interface ObservedForm {
  /** a short human label for the form (from a heading/legend/submit text). */
  label: string;
  /** the field names/types observed (never their values). */
  fields: string[];
  /** whether the form appears to authenticate (login/signup heuristic). */
  isAuth: boolean;
}

/** A single inspected page, reduced to structured, verifiable observations. */
export interface ProductObservation {
  /** canonical (post-redirect) URL of the inspected page. */
  url: string;
  /** HTTP status observed. */
  status: number;
  title: string;
  /** ordered visible headings (h1–h3), trimmed + capped. */
  headings: string[];
  /** distinct marketing/feature claims detected (short sentences). */
  claims: string[];
  /** visible call-to-action labels (button/link text that drives a flow). */
  ctas: string[];
  /** forms observed (labels + field names only — never submitted). */
  forms: ObservedForm[];
  /** same-origin navigation links discovered (canonical, deduped). */
  links: string[];
  /** whether this page sits behind an auth boundary (best-effort). */
  authBoundary: boolean;
  /** technology hints (framework/meta generator/analytics), non-authoritative. */
  techHints: string[];
  /** observable-without-mutation states (empty/error/loading copy) detected. */
  states: string[];
  /** accessibility landmarks / ARIA roles detected. */
  landmarks: string[];
  /** short verbatim evidence snippets that back the observations above. */
  snippets: string[];
  /** unix seconds the page was inspected. */
  inspectedAt: number;
  /** sha256 (hex) of the fetched content — the integrity anchor for this page. */
  contentSha256: string;
}

/** A read-only artifact observed in a public repository (never executed). */
export interface RepoArtifact {
  /** repo-relative path. */
  path: string;
  /** the kind of artifact (readme, manifest, route, config, test, doc, schema…). */
  kind: string;
  /** a short, sanitized observation about the artifact. */
  observation: string;
  /** sha256 (hex) of the (bounded) file bytes read. */
  contentSha256: string;
}

/* ──────────────────────────────────────────────── product map V1 ────────── */

/** A finding that always points back to where it came from. */
export interface SourceRef {
  kind: "page" | "repo" | "founder";
  /** the page URL, repo path, or "goal"/"target_users". */
  ref: string;
  /** the exact observation that produced the finding. */
  observation: string;
}

export interface MapFinding {
  /** the finding text (a route, surface, flow, risk, claim…). */
  value: string;
  /** 0..1 confidence in the finding. */
  confidence: number;
  /** one or more sources that back it (never empty for a real finding). */
  sources: SourceRef[];
  /** true when a browser fetch confirmed it; false when only code mentioned it. */
  browserConfirmed: boolean;
}

export const PRODUCT_MAP_V1_DOMAIN = "sage.productmap.v1" as const;

/* ────────────────────────────────────────────── field test (Playwright) ──────
 * The optional "Field Test": Sage actually loads the product in a real headless
 * browser (feature-flagged). These persisted result types live here (not in
 * field-test.ts) so schemas has no runtime dependency on Playwright. A form is
 * recorded READ-ONLY (attrs only) — the field test never fills or submits one. */

export interface FieldTestForm {
  method: string;
  action: string;
  fields: string[];
}

export interface FieldTestPage {
  url: string;
  title: string;
  h1: string;
  /** visible primary CTA/button texts (top 10). */
  ctas: string[];
  forms: FieldTestForm[];
  consoleErrors: string[];
  brokenRequests: { url: string; status: number }[];
  /** the page renders substantially only via JavaScript (raw HTML text ≪ rendered text). */
  jsOnly: boolean;
  /** public path to the full-page screenshot, e.g. /field-tests/<inspectionId>/0.png. */
  screenshot: string | null;
}

/** How the product renders — decided on entry from real signals (canvas, listeners, SPA routing…). */
export type ProductMode = "static" | "interactive";

export interface FieldTestNotableElement {
  tag: string;
  text: string;
  role: string;
}

/**
 * ONE observed state in interactive-explore mode — a real thing Sage saw after a real action
 * (initial load, waiting out a loading screen, clicking a start/continue control, pressing a key).
 * `visibleTextExcerpt` is RENDERED DOM text (not raw HTML). Anchors every interactive mission to
 * something actually observed — the antidote to confabulating missions from a loading screen.
 */
export interface FieldTestState {
  /** what produced this state, e.g. "initial load", "waited out loading", "clicked 'Start'", "pressed Space". */
  trigger: string;
  screenshot: string | null;
  /** rendered DOM visible text (not raw HTML), capped. */
  visibleTextExcerpt: string;
  notableElements: FieldTestNotableElement[];
  /** approximate visual change vs the previous captured state, 0..100 (a change signal, best-effort). */
  pixelDeltaPct: number;
  url: string;
}

export interface FieldTestSummary {
  /** true only when at least one page/state was actually browsed + captured. */
  ran: boolean;
  startUrl: string;
  /** static → a multi-page crawl (`pages`); interactive → a single-app state machine (`states`). */
  mode: ProductMode;
  pages: FieldTestPage[];
  /** interactive-mode observed states (empty in static mode). */
  states: FieldTestState[];
  /** honest one-line classification for the UI, e.g. "Interactive app detected · 5 states explored". */
  classification: string | null;
  /** an honest reason when the field test was skipped/degraded (null on success). */
  limitation: string | null;
  durationMs: number;
}

export interface ProductMapV1 {
  productName: string;
  category: string;
  valueProp: string;
  /** who Sage infers the users are (hypotheses, each with confidence + sources). */
  targetUserHypotheses: MapFinding[];
  /** the founder's own stated target users (verbatim, a founder source). */
  founderTargetUsers: string;
  /** the primary conversion journey, step by step (browser-confirmed where possible). */
  primaryJourney: MapFinding[];
  /** important public routes discovered. */
  routes: MapFinding[];
  /** major interactive surfaces (forms, editors, dashboards…). */
  interactiveSurfaces: MapFinding[];
  /** trust-sensitive surfaces (auth, wallet, payment, PII). */
  trustSurfaces: MapFinding[];
  /** content/claim risks worth validating with a human. */
  claimRisks: MapFinding[];
  /** observed error/empty states. */
  observedStates: MapFinding[];
  /** capabilities seen ONLY in the repo (not browser-confirmed). */
  repoOnlyCapabilities: MapFinding[];
  /** capabilities confirmed in the browser. */
  browserConfirmed: MapFinding[];
  /** honest limits of this inspection (JS-rendered flows, blocked pages, etc.). */
  limitations: string[];
  /** specific questions for the founder when evidence is insufficient. */
  openQuestions: string[];
  /** pages actually inspected. */
  pagesInspected: number;
  /** repo files actually inspected. */
  repoFilesInspected: number;
  /** the canonical digest over the normalized map. */
  digest: Hex;
  /**
   * Optional field-test evidence — present only when FIELD_TEST_ENABLED and the run
   * succeeded. EXCLUDED from `digest` (attached after it is computed), so an off/failed
   * field test leaves the map (and every downstream hash) byte-identical to today.
   */
  fieldTest?: FieldTestSummary | null;
}

/* ────────────────────────────────────────────── candidate mission ───────── */

export type MissionRiskCategory =
  | "critical_journey"
  | "onboarding"
  | "responsive"
  | "wallet_payment"
  | "claim_validation"
  | "error_recovery"
  | "accessibility"
  | "cross_browser"
  | "docs_consistency"
  | "trust_safety"
  | "regression";

export type MissionPriority = "high" | "medium" | "low";

/** A mission the architect proposes (LLM output shape, before validation). */
export interface CandidateMission {
  /** stable public mission key (kebab-case, unique in the plan). */
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  /** the exact URL/surface the mission is performed against (in inspected scope). */
  targetSurface: string;
  criteria: string[];
  evidenceRequirements: string[];
  /** why this matters for THIS product (product-specific, cited). */
  whyItMatters: string;
  /** the product observations that caused Sage to create this mission. */
  sources: SourceRef[];
  priority: MissionPriority;
  riskCategory: MissionRiskCategory;
  /** estimated tester effort in minutes. */
  effortMinutes: number;
  /** device/browser/wallet/account conditions the tester needs. */
  conditions: string[];
  /** 1..10 relative reward weight the architect suggests (compiler turns → money). */
  rewardWeight: number;
  /** suggested number of paid completions. */
  maxCompletions: number;
  /** how Sage could later verify the result (evidence-based). */
  verificationMethod: string;
  /** 0..1 architect confidence. */
  confidence: number;
  /** stated assumptions. */
  assumptions: string[];
  /** actions the tester must NOT take (destructive/authenticated/etc.). */
  disallowed: string[];
}

/* ───────────────────────────────────────────────── critic verdict ───────── */

export type CriticDecision = "accept" | "revise" | "merge" | "reject" | "needs_input";

export interface MissionCritique {
  missionKey: string;
  decision: CriticDecision;
  /** concise, structured reasons (decisions + corrections; never hidden CoT). */
  reasons: string[];
  /** when decision === "revise": the corrected mission. */
  revised?: CandidateMission;
  /** when decision === "needs_input": the founder question to resolve it. */
  question?: string;
}

/* ─────────────────────────────────────────── validation report ──────────── */

export type MissionValidationCode =
  | "spec_incompatible"
  | "empty_field"
  | "target_out_of_scope"
  | "unknown_source_ref"
  | "criteria_unordered_or_dup"
  | "evidence_unordered_or_dup"
  | "destructive_instruction"
  | "secret_request"
  | "wallet_signing_request"
  | "fund_transfer_request"
  | "security_exploitation"
  | "duplicate_objective"
  | "invalid_reward_or_cap"
  | "duplicate_mission_key"
  | "hallucinated_route"
  | "instructions_criteria_inconsistent"
  | "evidence_cannot_prove_criteria"
  | "unsupported_evidence_type"
  | "worthless_presence_check"
  | "prompt_injection_content";

export interface MissionValidationIssue {
  code: MissionValidationCode;
  field: string;
  detail: string;
}

export interface MissionValidationReport {
  ok: boolean;
  missionKey: string;
  issues: MissionValidationIssue[];
}

/* ───────────────────────────────────────────── budget allocation ────────── */

export interface AllocatedMission {
  missionKey: string;
  /** exact reward per completion in token base units. */
  rewardBase: bigint;
  maxCompletions: bigint;
  /** the effort/priority weight the compiler allocated from. */
  weight: number;
  effortMinutes: number;
}

export interface BudgetAllocation {
  ok: boolean;
  /** null when ok; else why the budget cannot fund a meaningful plan. */
  reason: string | null;
  missions: AllocatedMission[];
  totalBudgetBase: bigint;
  /** Σ(rewardBase × maxCompletions) — MUST equal totalBudgetBase when ok. */
  allocatedBase: bigint;
}

/* ─────────────────────────────────────────────── mission plan V1 ────────── */

export type MissionPlanStatus =
  | "draft"
  | "needs_input"
  | "deployment_ready";

/** A single mission, fully compiled with its canonical identity + economics. */
export interface CompiledMission {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceRequirements: string[];
  whyItMatters: string;
  sources: SourceRef[];
  riskCategory: MissionRiskCategory;
  priority: MissionPriority;
  effortMinutes: number;
  rewardBase: bigint;
  maxCompletions: bigint;
  verificationMethod: string;
  /** bytes32 — missionIdHash(publicCampaignId, missionKey). */
  missionIdHash: Hex;
  /** bytes32 — the MissionSpecV1 digest. */
  specDigest: Hex;
}

export interface MissionPlanV1 {
  /** the public campaign id (frozen on approval; the DB primary key + slug). */
  publicCampaignId: string;
  status: MissionPlanStatus;
  /** monotonically increasing revision (each material edit is a new revision). */
  revision: number;
  productMapDigest: Hex;
  missions: CompiledMission[];
  totalBudgetBase: bigint;
  allocatedBase: bigint;
  tokenDecimals: number;
  /** bytes32 — campaignIdHash(publicCampaignId). */
  campaignIdHash: Hex;
  /** bytes32 — the on-chain mission-plan digest (IDs/rewards/caps). */
  missionPlanDigest: Hex;
  /** open questions when status === "needs_input". */
  openQuestions: string[];
  /** the model + prompt schema version that produced the candidates. */
  modelVersion: string;
  promptVersion: string;
}

/* ─────────────────────────────────────────── normalization + digest ─────── */

/** NFC + outer-trim — meaning-preserving, never an inner rewrite (matches mission-spec). */
export function norm(s: string): string {
  return s.normalize("NFC").trim();
}

const MAP_ABI = [
  { type: "bytes32" }, // domain
  { type: "bytes32" }, // productName
  { type: "bytes32" }, // category
  { type: "bytes32" }, // valueProp
  { type: "bytes32" }, // founderTargetUsers
  { type: "bytes32[]" }, // routes (ordered, browser-confirmed values)
  { type: "bytes32[]" }, // primaryJourney (ordered)
  { type: "bytes32[]" }, // trustSurfaces
  { type: "uint256" }, // pagesInspected
  { type: "uint256" }, // repoFilesInspected
] as const;

/**
 * The canonical ProductMapV1 digest. Deterministic over the load-bearing, normalized
 * fields — same inspection inputs produce the same digest. Presentation-only fields
 * (confidence, snippets) are excluded so cosmetic churn never changes the digest.
 */
export function productMapDigest(map: Omit<ProductMapV1, "digest">): Hex {
  const h = (s: string): Hex => keccak256(stringToHex(norm(s)));
  const vals = (f: MapFinding[]): Hex[] => f.map((x) => h(x.value));
  return keccak256(
    encodeAbiParameters(MAP_ABI, [
      keccak256(stringToHex(PRODUCT_MAP_V1_DOMAIN)),
      h(map.productName),
      h(map.category),
      h(map.valueProp),
      h(map.founderTargetUsers),
      vals(map.routes),
      vals(map.primaryJourney),
      vals(map.trustSurfaces),
      BigInt(map.pagesInspected),
      BigInt(map.repoFilesInspected),
    ]),
  );
}
