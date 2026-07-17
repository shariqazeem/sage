/**
 * The deterministic mission quality gate. No LLM output becomes a founder-visible
 * mission until it passes here. Pure + testable. It enforces MissionSpecV1
 * compatibility, cited-source existence, in-scope targeting (no hallucinated routes),
 * ordered/unique criteria + evidence, and — the safety-critical part — that a mission
 * never instructs a tester to do anything destructive, to reveal a secret, to sign a
 * wallet transaction, to move funds, or to run a security exploit, and never carries
 * prompt-injection content echoed from inspected pages. A failing mission is revised
 * or removed by the caller; it is NEVER silently accepted.
 */

import { detectInjection } from "@/lib/deputy/brain-core";
import { validateMissionSpec } from "@/lib/campaigns/mission-spec";
import { detectUnsupportedEvidence } from "./evidence-capabilities";
import { norm } from "./schemas";
import type {
  CandidateMission,
  FieldTestSummary,
  MissionValidationCode,
  MissionValidationIssue,
  MissionValidationReport,
  ProductObservation,
} from "./schemas";

/** The known, inspected scope a mission must stay inside. */
export interface ValidationScope {
  /** every URL Sage actually observed (inspected pages + discovered same-origin links). */
  knownUrls: Set<string>;
  /** the same-origin hosts inspected. */
  hosts: Set<string>;
  /** repo paths observed (for repo-sourced missions). */
  repoPaths: Set<string>;
}

/* ── destructive / secret / signing / fund / exploit patterns (the tester must NOT) ── */

const DESTRUCTIVE = [
  /\b(delete|remove|destroy|wipe|erase|purge|drop|reset|uninstall)\b[^.\n]{0,24}\b(account|data|repo|repository|project|workspace|files?|database|everything|settings)\b/i,
  /\b(complete|make|place|submit|do|perform)\b[^.\n]{0,18}\b(purchase|order|payment|checkout|transaction|subscription)\b/i,
  /\b(buy|pay for|purchase|check ?out|subscribe)\b[^.\n]{0,18}\b(with|using|for|a real|real money|your (card|account|money))\b/i,
  /\bformat (the )?(disk|drive)\b/i,
];
const SECRET_REQUEST = [
  /\b(share|send|paste|reveal|provide|enter) (your|the|their|a) (password|api key|api-key|secret|private key|seed phrase|mnemonic|recovery phrase|token|credential)/i,
  /\b(login|log in|sign in) (with|using) (your|the) real (credentials|account|password)/i,
];
const WALLET_SIGNING = [
  /\bsign (a|an|the|this|any) (transaction|message|payload|approval|permit)\b/i,
  /\bapprove (a|an|the|this|token) (spend|allowance|transaction)\b/i,
  /\bconnect (your|a) wallet and (sign|approve|send)/i,
];
const FUND_TRANSFER = [
  /\b(send|transfer|deposit|withdraw|swap|bridge|move)\b[^.\n]{0,24}\b(funds|money|eth|usdc|usdt|dai|tokens?|crypto|assets|coins?|balance)\b/i,
  /\bpay (the |a )?(fee|gas)\b[^.\n]{0,20}\byour own\b/i,
];
const SECURITY_EXPLOIT = [
  /\b(sql injection|xss|cross-site scripting|csrf|ddos|denial.of.service|brute.force|exploit|payload injection|bypass authentication|privilege escalation)\b/i,
  /\b(hack|penetrat|breach|compromise) (the|their|this) (server|database|system|account)/i,
];

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

/* ── "worth paying for" gate: a mission whose SUCCESS is merely that a DOM element exists ── */

// A criterion that just asserts an element/text is PRESENT / exists / is visible / is identifiable /
// has an accessible name — the hallmark of a worthless presence check (paying a human to confirm a
// button is in the DOM). Deliberately narrow, matched against criteria (which define success).
const PRESENCE_CRITERION =
  /\b(present in the (dom|document|page|markup)|exists? in the (dom|document|page|markup)|element (exists?|is present)|(is|are)\b[^.]{0,30}\bpresent\b|\bis (visible|identifiable|discoverable)\b|identifiable (via|by|through)|(has|possess(es)?|contain(s)?)\b[^.]{0,30}\b(accessible|aria)[- ]?(name|label)|non-empty\b[^.]{0,20}\b(accessible|aria|name|label|identifier))/i;

// An action→OUTCOME signal: the criterion (or objective) hinges on a real thing HAPPENING — a URL is
// reached, a page loads, a state changes, something results from an action. Any of these means the
// mission is NOT a bare presence check, so it is kept. (A bare "navigate to <url>" does NOT count —
// every mission has that; we require a produced result.)
const ACTION_OUTCOME =
  /\b(leads? to|results? in|reach(es|ed|ing)? the (url|page|screen|view|state)|redirect(s|ed|ing)? to|navigat(es|ed|ing) to the (url|page)|after (you )?(submit|click|sign|complet|search|enter|select|toggl|load|scroll)|the (reached|resulting|destination|next|following|new|updated) (page|screen|url|state|view)|successfully\b|is (added|created|saved|updated|removed|toggled|enabled|disabled|shown|displayed|returned) (after|when|once|upon)|responds? (with|to)|changes? (to|when|after))/i;

/**
 * True when a mission's success is merely confirming a DOM element/text is PRESENT, with no action
 * that produces an observable outcome — worthless to pay a human for (the yara.garden failure). Pure.
 * Conservative by design: fires only when a real presence criterion is there, the mission reads as a
 * presence check (objective or a majority of criteria), AND nothing anywhere signals an action→outcome.
 */
export function isWorthlessPresenceCheck(m: Pick<CandidateMission, "objective" | "criteria" | "instructions">): boolean {
  const crits = m.criteria.map(norm).filter(Boolean);
  if (crits.length === 0) return false; // emptiness is handled by the spec gate
  const presenceCrits = crits.filter((c) => PRESENCE_CRITERION.test(c)).length;
  if (presenceCrits === 0) return false;
  const objective = norm(m.objective);
  const looksLikePresence = PRESENCE_CRITERION.test(objective) || presenceCrits / crits.length >= 0.5;
  const blob = `${objective}\n${norm(m.instructions)}\n${crits.join("\n")}`;
  const hasOutcome = ACTION_OUTCOME.test(blob);
  return looksLikePresence && !hasOutcome;
}

function urlOrNull(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** Every http(s) URL mentioned in a blob (to catch out-of-scope links in instructions). */
function urlsIn(text: string): string[] {
  return text.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
}

/* ───────── the anchor gate: a mission may only claim what Sage actually observed ─────────── */

const CORPUS_CAP = 80_000;
const MIN_ANCHOR_LEN = 3;

/** Normalize text for anchor matching: lowercase + collapse whitespace. */
function normAnchorText(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The OBSERVATION CORPUS — one normalized blob of every string Sage actually observed (static
 * inspection + field-test states + vision). The anchor gate requires each mission anchor to be a
 * literal substring of this corpus, so a mission cannot claim a feature ("Zoom Control") that was
 * never seen, regardless of what any model emits. Pure + deterministic.
 */
export function buildObservationCorpus(observations: ProductObservation[], fieldTest?: FieldTestSummary | null): string {
  const parts: string[] = [];
  const push = (v?: string | null) => {
    if (v) parts.push(v);
  };
  const pushAll = (a?: (string | null | undefined)[]) => {
    for (const x of a ?? []) push(x);
  };

  for (const o of observations) {
    push(o.title);
    pushAll(o.headings);
    pushAll(o.claims);
    pushAll(o.ctas);
    pushAll(o.snippets);
    pushAll(o.states);
    pushAll(o.landmarks);
    for (const f of o.forms ?? []) {
      push(f.label);
      pushAll(f.fields);
    }
    for (const l of o.links ?? []) {
      try {
        push(new URL(l, o.url).pathname);
      } catch {
        /* skip */
      }
    }
    try {
      push(new URL(o.url).pathname);
    } catch {
      /* skip */
    }
  }

  if (fieldTest) {
    for (const p of fieldTest.pages ?? []) {
      push(p.title);
      push(p.h1);
      pushAll(p.ctas);
    }
    for (const s of fieldTest.states ?? []) {
      push(s.trigger);
      push(s.visibleTextExcerpt);
      for (const e of s.notableElements ?? []) push(e.text);
    }
    for (const v of fieldTest.visionObservations ?? []) {
      push(v.sceneDescription);
      pushAll(v.visibleText);
      for (const e of v.uiElements ?? []) push(e.label);
      pushAll(v.productTypeSignals);
      pushAll(v.audienceSignals);
      pushAll(v.qualityIssues);
    }
  }

  return normAnchorText(parts.join(" • ")).slice(0, CORPUS_CAP);
}

/**
 * The anchor check: a mission MUST cite at least one anchor, and EVERY anchor must be a literal
 * (normalized) substring of the observation corpus. This is the anti-hallucination core — it runs
 * mechanically, before any model opinion. Returns the issues found (empty when the mission is anchored).
 */
export function anchorIssues(m: Pick<CandidateMission, "anchors">, corpus: string): MissionValidationIssue[] {
  const anchors = (m.anchors ?? []).map(normAnchorText).filter((a) => a.length >= MIN_ANCHOR_LEN);
  if (anchors.length === 0) {
    return [{ code: "unanchored_claim", field: "anchors", detail: "mission cites no verbatim observed anchor — it may be invented" }];
  }
  for (const a of anchors) {
    if (!corpus.includes(a)) {
      return [{ code: "unanchored_claim", field: "anchors", detail: `anchor was never observed by Sage: "${a.slice(0, 48)}"` }];
    }
  }
  return [];
}

const REACHES_URL = /\b(leads? to|redirect(s|ed|ing)?|reach(es|ed|ing)? (the )?(url|page)|navigat\w+ to (the )?(url|https?|page)|results? in .*\b(url|page)\b)/i;
const FINDS_TEXT = /\b(contains?|displays?|shows?)\b[^.]*\b(text|heading|h1|title|word|url|label)\b|\bas (an? )?h1\b|the (reached|destination|resulting) page\b/i;

/**
 * Deterministic verifiability class: URL-VERIFIABLE when completion is provable by fetching a public
 * page and quoting its text (the criteria hinge on reaching a specific URL/page AND finding specific
 * text/heading there); OBSERVATION-BASED otherwise (the tester's judged written account). Pure.
 */
export function classifyVerifiability(m: Pick<CandidateMission, "objective" | "criteria" | "evidenceRequirements">): "url-verifiable" | "observation-based" {
  const blob = `${m.objective}\n${m.criteria.join("\n")}\n${m.evidenceRequirements.join("\n")}`;
  return REACHES_URL.test(blob) && FINDS_TEXT.test(blob) ? "url-verifiable" : "observation-based";
}

/* ─────────── sufficiency: is there enough real observation to design paid work? ─────────── */

/** Below this, Sage saw too little to design missions worth paying for → needs_input. Deliberately
 *  low: the anchor gate is the primary protection, so this only catches a near-empty inspection (a
 *  login wall, a blank SPA), never a normal single-page product. */
export const SUFFICIENCY_THRESHOLD = 3.0;

export interface RichnessSignals {
  /** interactive states explored. */
  states: number;
  /** pages inspected (static). */
  pages: number;
  /** vision observations captured. */
  vision: number;
  /** distinct interactive elements/CTAs seen. */
  distinctElements: number;
  /** total observed-text length (the corpus). */
  textLen: number;
}

/**
 * A deterministic observation-richness score. Weights pages + interactive states + vision + distinct
 * elements + raw text volume. Used only as a floor: rich products (yara: 6 states + 6 vision) score
 * high and proceed; near-empty inspections (a login wall) score low → needs_input. Pure.
 */
export function observationScore(s: RichnessSignals): number {
  return (
    Math.min(s.states, 6) * 1.0 +
    Math.min(s.pages, 6) * 1.5 +
    Math.min(s.vision, 6) * 1.0 +
    Math.min(s.distinctElements, 15) * 0.4 +
    Math.min(s.textLen / 400, 15) * 1.0
  );
}

/**
 * Validate a single candidate mission against the deterministic rules + the inspected
 * scope. Returns a structured report; `ok` is true only when there are zero issues.
 */
export function validateMission(m: CandidateMission, scope: ValidationScope, corpus?: string): MissionValidationReport {
  const issues: MissionValidationIssue[] = [];
  const add = (code: MissionValidationCode, field: string, detail: string) =>
    issues.push({ code, field, detail });

  // 1. MissionSpecV1 compatibility (uses the FROZEN validator with placeholder hashes).
  const specErr = validateMissionSpec({
    campaignIdHash: `0x${"0".repeat(64)}`,
    missionIdHash: `0x${"0".repeat(64)}`,
    title: m.title,
    objective: m.objective,
    instructions: m.instructions,
    targetSurface: m.targetSurface,
    criteria: m.criteria,
    evidenceRequirements: m.evidenceRequirements,
    rewardBase: BigInt(1),
    maxCompletions: BigInt(Math.max(1, Math.floor(m.maxCompletions || 1))),
  });
  if (specErr) {
    // spec digest fields that are empty/dup/too-long surface with a precise code.
    if (/^empty_/.test(specErr)) add("empty_field", specErr.replace("empty_", ""), `mission spec: ${specErr}`);
    else if (specErr === "duplicate_criterion") add("criteria_unordered_or_dup", "criteria", specErr);
    else if (specErr === "duplicate_evidence") add("evidence_unordered_or_dup", "evidenceRequirements", specErr);
    else add("spec_incompatible", "spec", `mission spec rejected: ${specErr}`);
  }

  // 2. non-empty operational fields the spec does not cover.
  if (norm(m.whyItMatters).length === 0) add("empty_field", "whyItMatters", "missing why-it-matters");
  if (norm(m.verificationMethod).length === 0) add("empty_field", "verificationMethod", "missing verification method");
  if (norm(m.missionKey).length === 0 || !/^[a-z0-9][a-z0-9-]*$/.test(m.missionKey))
    add("empty_field", "missionKey", "mission key must be non-empty kebab-case");

  // 3. target surface must be inside the inspected scope (no hallucinated routes).
  const target = urlOrNull(m.targetSurface);
  if (!target || target.protocol !== "https:") {
    add("target_out_of_scope", "targetSurface", "target surface must be an https URL");
  } else if (!scope.hosts.has(target.host.toLowerCase())) {
    add("target_out_of_scope", "targetSurface", `host ${target.host} was not inspected`);
  } else {
    const canon = target.toString();
    const originRoot = `${target.origin}/`;
    if (!scope.knownUrls.has(canon) && canon !== originRoot && canon !== target.origin) {
      add("hallucinated_route", "targetSurface", `${canon} was not observed during inspection`);
    }
  }

  // any other URL referenced in the instructions must be same-origin / in-scope.
  for (const u of urlsIn(m.instructions)) {
    const parsed = urlOrNull(u);
    if (parsed && !scope.hosts.has(parsed.host.toLowerCase())) {
      add("hallucinated_route", "instructions", `instructions reference an out-of-scope URL: ${parsed.host}`);
      break;
    }
  }

  // 4. every cited source must exist.
  if (!m.sources || m.sources.length === 0) {
    add("unknown_source_ref", "sources", "a mission must cite at least one real product observation");
  } else {
    for (const s of m.sources) {
      const ref = norm(s.ref);
      const exists =
        (s.kind === "page" && scope.knownUrls.has(ref)) ||
        (s.kind === "repo" && scope.repoPaths.has(ref)) ||
        (s.kind === "founder" && (ref === "goal" || ref === "target_users"));
      if (!exists) {
        add("unknown_source_ref", "sources", `cited source does not exist: ${s.kind}:${ref}`);
        break;
      }
    }
  }

  // 5. reward weight + cap validity.
  if (!(m.rewardWeight >= 1 && m.rewardWeight <= 10)) add("invalid_reward_or_cap", "rewardWeight", "reward weight must be 1..10");
  if (!(m.maxCompletions >= 1)) add("invalid_reward_or_cap", "maxCompletions", "completions must be ≥ 1");
  if (!(m.effortMinutes > 0)) add("invalid_reward_or_cap", "effortMinutes", "effort must be > 0");

  // 6. SAFETY — a mission must never ask a tester to do harm.
  const actionText = `${m.title}\n${m.objective}\n${m.instructions}\n${m.criteria.join("\n")}`;
  if (anyMatch(DESTRUCTIVE, actionText)) add("destructive_instruction", "instructions", "mission asks the tester to perform a destructive or purchasing action");
  if (anyMatch(SECRET_REQUEST, actionText)) add("secret_request", "instructions", "mission asks the tester to reveal a secret/credential");
  if (anyMatch(WALLET_SIGNING, actionText)) add("wallet_signing_request", "instructions", "mission asks the tester to sign a wallet transaction");
  if (anyMatch(FUND_TRANSFER, actionText)) add("fund_transfer_request", "instructions", "mission asks the tester to move real funds");
  if (anyMatch(SECURITY_EXPLOIT, actionText)) add("security_exploitation", "instructions", "mission asks for prohibited security exploitation");

  // 7. prompt-injection content echoed from inspected pages (model-independent detector).
  if (detectInjection(actionText).length > 0)
    add("prompt_injection_content", "instructions", "mission text contains instruction-injection patterns from inspected content");

  // 8. evidence must be able to prove the criteria (light, non-eager heuristic).
  const trivialEvidence = m.evidenceRequirements.every((e) => norm(e).length < 8);
  if (m.evidenceRequirements.length > 0 && trivialEvidence)
    add("evidence_cannot_prove_criteria", "evidenceRequirements", "evidence requirements are too vague to verify the criteria");

  // 9. evidence must be a type Sage can actually verify (public URL + quoted/observed text).
  // A screenshot/image/video/file/private-auth requirement can never be verified or paid, so
  // the mission is rejected and regenerated before the founder ever sees it.
  const unsupported = detectUnsupportedEvidence({
    evidenceRequirements: m.evidenceRequirements,
    criteria: m.criteria,
    instructions: m.instructions,
  });
  if (unsupported)
    add(
      "unsupported_evidence_type",
      unsupported.field,
      `requires ${unsupported.category} ("${unsupported.match}") — Sage can only verify a public URL + quoted/observed text`,
    );

  // 10. WORTH PAYING FOR — reject a mission whose success is merely that a DOM element exists.
  // A presence check is worthless to pay a human for; the model is untrusted here, so the gate
  // enforces it deterministically. Dropping every candidate leaves 0 accepted → the pipeline
  // asks the founder what verifiable outcome they want (needs_input) rather than confabulating.
  if (isWorthlessPresenceCheck(m))
    add("worthless_presence_check", "criteria", "mission only confirms an element is present in the DOM — not worth paying a tester for; require an action + observable outcome");

  // 11. ANCHOR GATE (anti-hallucination core) — when a corpus is supplied, every mission anchor MUST be
  // a verbatim substring of what Sage actually observed. A mission about a "Zoom Control" that was never
  // seen cannot pass, whatever a model claimed. Skipped when no corpus is threaded (byte-identical).
  if (corpus !== undefined) for (const issue of anchorIssues(m, corpus)) issues.push(issue);

  return { ok: issues.length === 0, missionKey: m.missionKey, issues };
}

/**
 * Validate a whole set of candidate missions: per-mission rules PLUS cross-mission
 * rules (unique public keys, no duplicate objective). Returns per-mission reports; a
 * mission that fails any rule has `ok:false`.
 */
export function validatePlanMissions(
  missions: CandidateMission[],
  scope: ValidationScope,
  corpus?: string,
): MissionValidationReport[] {
  const keyCount = new Map<string, number>();
  const objCount = new Map<string, number>();
  for (const m of missions) {
    keyCount.set(m.missionKey, (keyCount.get(m.missionKey) ?? 0) + 1);
    const objKey = norm(m.objective).toLowerCase();
    objCount.set(objKey, (objCount.get(objKey) ?? 0) + 1);
  }
  return missions.map((m) => {
    const report = validateMission(m, scope, corpus);
    if ((keyCount.get(m.missionKey) ?? 0) > 1)
      report.issues.push({ code: "duplicate_mission_key", field: "missionKey", detail: `key '${m.missionKey}' is not unique` });
    if ((objCount.get(norm(m.objective).toLowerCase()) ?? 0) > 1)
      report.issues.push({ code: "duplicate_objective", field: "objective", detail: "another mission shares this objective" });
    report.ok = report.issues.length === 0;
    return report;
  });
}
