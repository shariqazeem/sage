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
  MissionValidationCode,
  MissionValidationIssue,
  MissionValidationReport,
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

/**
 * Validate a single candidate mission against the deterministic rules + the inspected
 * scope. Returns a structured report; `ok` is true only when there are zero issues.
 */
export function validateMission(m: CandidateMission, scope: ValidationScope): MissionValidationReport {
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
): MissionValidationReport[] {
  const keyCount = new Map<string, number>();
  const objCount = new Map<string, number>();
  for (const m of missions) {
    keyCount.set(m.missionKey, (keyCount.get(m.missionKey) ?? 0) + 1);
    const objKey = norm(m.objective).toLowerCase();
    objCount.set(objKey, (objCount.get(objKey) ?? 0) + 1);
  }
  return missions.map((m) => {
    const report = validateMission(m, scope);
    if ((keyCount.get(m.missionKey) ?? 0) > 1)
      report.issues.push({ code: "duplicate_mission_key", field: "missionKey", detail: `key '${m.missionKey}' is not unique` });
    if ((objCount.get(norm(m.objective).toLowerCase()) ?? 0) > 1)
      report.issues.push({ code: "duplicate_objective", field: "objective", detail: "another mission shares this objective" });
    report.ok = report.issues.length === 0;
    return report;
  });
}
