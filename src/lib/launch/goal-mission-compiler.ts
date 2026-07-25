import { createHash } from "node:crypto";
import type {
  EntityInstanceV1,
  ProductContextV1,
  ExperiencePhase,
} from "./product-context";
import { phaseAtLeast } from "./product-context";
import type {
  GoalCheckpointV1,
  GoalJourneyV1,
  JourneyStep,
  CheckpointEvidenceMapping,
} from "./goal-journey";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission, CriterionGroundingV1 } from "./schemas";

/**
 * The deterministic GOAL → MISSION compiler.
 *
 * Sage already knows the founder's ordered journey, which entity occurrences exist in which product
 * phase, and exactly which observed facts completed each checkpoint. So the mapping from the founder's
 * request to a payable mission is a COMPILATION, not a writing task: this module derives the criteria,
 * the evidence requirements, the fact ids behind each one, the anchors, and the checkpoint→criterion→
 * evidence mapping. A model may only polish the human-readable prose afterwards; it can never choose or
 * alter a mapping, a fact id, an evidence index, an entity id, or an evidence mode.
 *
 * Product-agnostic: every string it emits is composed from the founder's own requirement text and the
 * product's own observed labels.
 */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const lower = (s: string) => norm(s).toLowerCase();
const words = (s: string) =>
  lower(s)
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((w) => w.length >= 3);

/* ─────────────────────── 1. behavioral entity resolution ──────────────────── */

export interface EntityCandidateScore {
  entity: EntityInstanceV1;
  score: number;
  reasons: string[];
}

export interface EntityResolution {
  /** the single best occurrence, or null when none qualifies / the top candidates tie behaviorally. */
  resolved: EntityInstanceV1 | null;
  /** ranked candidates (highest first) — for telemetry and the ambiguity question. */
  ranked: EntityCandidateScore[];
  /** true ONLY when the top candidates are behaviorally EQUIVALENT (identical score). */
  ambiguous: boolean;
}

/**
 * Rank the occurrences of a checkpoint's entity by BEHAVIOUR, not by label similarity:
 *   1. the required product phase (a candidate in an earlier phase is excluded outright);
 *   2. the semantic entity type expected by the checkpoint kind (a control for an interaction, a field
 *      for an input);
 *   3. an exact normalized label match;
 *   4. the required interaction affordance (can it actually be clicked/typed into?);
 *   5. the OBSERVED required outcome — acting on this occurrence was actually followed by the journey's
 *      later steps (the conversation, the reply). This is what makes a place named after the character
 *      rank below the character herself.
 * Deterministic; the founder is asked ONLY when the top candidates score identically.
 */
export function resolveEntityForCheckpoint(
  cp: GoalCheckpointV1,
  context: ProductContextV1,
  steps: readonly JourneyStep[],
  /** the index of the first step that shows the founder's required outcome (input/response), if any. */
  outcomeStepIndex: number | null,
): EntityResolution {
  const wanted = words(cp.targetEntity);
  if (wanted.length === 0)
    return { resolved: null, ranked: [], ambiguous: false };
  const requiredPhase: ExperiencePhase = cp.requiredPhase ?? "entry";
  const wantsControl =
    cp.kind === "interaction" ||
    cp.kind === "navigation" ||
    cp.kind === "outcome";
  const wantsField = cp.kind === "input";

  const ranked: EntityCandidateScore[] = [];
  for (const e of context.entities) {
    const label = lower(e.label);
    if (!wanted.some((w) => label.includes(w))) continue;
    // (1) phase — an occurrence before the required phase is not a candidate at all.
    if (!phaseAtLeast(e.phase, requiredPhase)) continue;
    let score = 0;
    const reasons: string[] = [`phase:${e.phase}`];
    // (5) behavioural: was acting on THIS occurrence followed by the founder's required outcome?
    const actedStep = steps.findIndex(
      (s) =>
        s.stateIndex === e.stateIndex && lower(s.actedLabel ?? "") === label,
    );
    const actedHere = steps.some((s) => lower(s.actedLabel ?? "") === label);
    if (actedHere && outcomeStepIndex !== null) {
      const idx = steps.findIndex((s) => lower(s.actedLabel ?? "") === label);
      if (idx >= 0 && idx <= outcomeStepIndex) {
        // acting on it preceded the outcome — and the closer it sits to the outcome, the more it is
        // the thing that produced it (a place clicked long before is weaker than the entity clicked
        // immediately before the conversation began).
        score += 60 - Math.min(50, (outcomeStepIndex - idx) * 10);
        reasons.push(`led_to_outcome(distance=${outcomeStepIndex - idx})`);
      }
    }
    // (4) affordance
    if (wantsField && e.affordances.includes("type")) {
      score += 25;
      reasons.push("typable");
    } else if (wantsControl && e.affordances.includes("click")) {
      score += 20;
      reasons.push("clickable");
    }
    // (2) semantic type
    if (wantsControl && e.kind === "control") {
      score += 10;
      reasons.push("kind:control");
    } else if (wantsField && e.kind === "field") {
      score += 10;
      reasons.push("kind:field");
    } else if (e.kind === "heading" || e.kind === "item") {
      score += 2;
      reasons.push(`kind:${e.kind}`);
    }
    // (3) label exactness
    const exact =
      wanted.every((w) => label.includes(w)) &&
      label.length <= norm(cp.targetEntity).length + 4;
    if (exact) {
      score += 15;
      reasons.push("label:exact");
    } else if (label.split(/\s+/).length <= 2) {
      score += 5;
      reasons.push("label:tight");
    }
    // a deeper phase is slightly preferred (the target interaction is where the goal actually happened)
    if (phaseAtLeast(e.phase, "target_interaction")) score += 3;
    if (actedStep >= 0) {
      score += 5;
      reasons.push("acted_in_this_state");
    }
    ranked.push({ entity: e, score, reasons });
  }

  ranked.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.entity.entityId.localeCompare(b.entity.entityId),
  );
  if (ranked.length === 0) return { resolved: null, ranked, ambiguous: false };
  // ask ONLY when the leaders are behaviourally equivalent (identical score) AND their labels differ.
  const top = ranked[0];
  const tied = ranked.filter((r) => r.score === top.score);
  const distinctLabels = new Set(tied.map((r) => lower(r.entity.label)));
  if (tied.length > 1 && distinctLabels.size > 1)
    return { resolved: null, ranked, ambiguous: true };
  return { resolved: top.entity, ranked, ambiguous: false };
}

/* ─────────────────────── 2. the deterministic mission compiler ─────────────── */

export interface CompiledCriterion {
  index: number;
  text: string;
  evidenceText: string;
  checkpointIds: string[];
  factIds: string[];
  transitionIds: string[];
  evidenceMode: CriterionGroundingV1["verificationMode"];
  criterionKind: NonNullable<CriterionGroundingV1["criterionKind"]>;
  stateId?: string;
  pageUrl?: string;
}

export interface CompiledGoalMission {
  mission: CandidateMission;
  /** checkpoint → mission / criterionIndex / evidenceIndex / ids / mode. Compiler-owned. */
  mappings: CheckpointEvidenceMapping[];
  criteria: CompiledCriterion[];
  resolvedEntity: EntityInstanceV1 | null;
}

export type CompileGoalResult =
  | { ok: true; compiled: CompiledGoalMission }
  | { ok: false; reason: string; question?: string };

export interface CompileGoalInput {
  journey: GoalJourneyV1;
  context: ProductContextV1;
  steps: readonly JourneyStep[];
  facts: readonly ObservedFactV1[];
  transitions: readonly ActionTransitionV1[];
  productUrl: string;
  totalBudgetBase: bigint;
}

/** The step where the founder's required outcome was observed (the reply / result). */
function outcomeStep(steps: readonly JourneyStep[]): number | null {
  const i = steps.findIndex((s) => s.actionKind === "observe_response");
  if (i >= 0) return i;
  const j = steps.map((s) => s.actionKind).lastIndexOf("submit");
  return j >= 0 ? j : null;
}

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Join requirement sentences into one readable clause without inventing claims. */
function joinRequirements(cps: GoalCheckpointV1[]): string {
  const parts = cps.map((c) => lower(c.requirement).replace(/\.$/, ""));
  if (parts.length === 1) return titleCase(parts[0]);
  return titleCase(
    parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1],
  );
}

/** Exact anchors: verbatim observed strings from the cited facts (the anchor gate checks the corpus). */
function anchorsFrom(
  facts: readonly ObservedFactV1[],
  ids: readonly string[],
  limit = 3,
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const f = facts.find((x) => x.id === id);
    if (!f) continue;
    const candidate = f.elementName || f.visibleTexts[0] || "";
    const c = norm(candidate);
    if (c.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && !out.includes(c))
      out.push(c.slice(0, 120));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Collect the cited fact ids for a criterion so that EVERY checkpoint it covers keeps at least one of its
 * own facts. A flat slice can silently drop a checkpoint's only evidence, which breaks its
 * checkpoint→criterion→evidence mapping (`goal_checkpoint_evidence_unmapped`) even though Sage observed
 * it. Round-robin first (one per checkpoint, in order), then top up to the cap. Pure + deterministic.
 */
function citedFactIds(
  groups: readonly GoalCheckpointV1[],
  cap: number,
): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (id && !out.includes(id) && out.length < cap) out.push(id);
  };
  for (const c of groups) push(c.evidence.factIds[0] ?? ""); // one per checkpoint — none left unmapped
  for (let i = 1; out.length < cap; i++) {
    const before = out.length;
    for (const c of groups) push(c.evidence.factIds[i] ?? "");
    if (out.length === before) break;
  }
  return out;
}

/**
 * Compile the founder's observed journey into ONE grounded mission with a small number of meaningful
 * criteria. Grouping is deterministic and general:
 *   · entry / "reach the experience" prerequisites become mission INSTRUCTIONS and attach to the first
 *     core criterion (they are preconditions, not separate paid outcomes);
 *   · reaching the target entity + opening the interaction is ONE core criterion;
 *   · supplying the input + observing the result is ONE outcome criterion, carrying DISTINCT send-state
 *     and response-state evidence.
 * Every checkpoint still maps to exactly one criterion/evidence pair.
 */
export function compileGoalMission(input: CompileGoalInput): CompileGoalResult {
  const { journey, context, steps, facts, transitions } = input;
  const cps = journey.checkpoints;
  if (cps.length === 0) return { ok: false, reason: "empty_journey" };
  if (cps.some((c) => c.status !== "observed"))
    return { ok: false, reason: "journey_incomplete" };

  const oStep = outcomeStep(steps);
  // the TARGET entity of the founder's request — the entity named by the latest entity-bearing checkpoint.
  const entityCps = cps.filter((c) => c.targetEntity);
  const targetCp = [...entityCps]
    .reverse()
    .find(
      (c) =>
        c.kind === "outcome" ||
        c.kind === "input" ||
        c.kind === "interaction" ||
        c.kind === "navigation",
    );
  let resolvedEntity: EntityInstanceV1 | null = null;
  if (targetCp) {
    const res = resolveEntityForCheckpoint(targetCp, context, steps, oStep);
    if (res.ambiguous) {
      const labels = [
        ...new Set(
          res.ranked
            .filter((r) => r.score === res.ranked[0].score)
            .map((r) => r.entity.label),
        ),
      ];
      return {
        ok: false,
        reason: "entity_ambiguous",
        question: `Sage found ${labels.length} equally likely things called "${targetCp.targetEntity}" (${labels.slice(0, 3).join(", ")}) and they behave the same way. Which one should testers use for "${targetCp.requirement}"?`,
      };
    }
    resolvedEntity = res.resolved;
  }

  // ── grouping ───────────────────────────────────────────────────────────────
  const outcomeGroup = cps.filter(
    (c) => c.kind === "input" || c.kind === "outcome",
  );
  const coreGroup = cps.filter(
    (c) =>
      !outcomeGroup.includes(c) &&
      (c.kind === "interaction" ||
        (c.kind === "navigation" &&
          !!c.targetEntity &&
          c === targetCpOrCore(cps, targetCp))),
  );
  const prereqs = cps.filter(
    (c) => !outcomeGroup.includes(c) && !coreGroup.includes(c),
  );
  // the core criterion always exists: if nothing qualified, the last non-outcome checkpoint is the core.
  const core =
    coreGroup.length > 0
      ? coreGroup
      : prereqs.length > 0
        ? [prereqs[prereqs.length - 1]]
        : [];
  const prereqOnly = prereqs.filter((c) => !core.includes(c));

  const entityLabel =
    resolvedEntity?.label ?? targetCp?.targetEntity ?? "the target";
  const criteria: CompiledCriterion[] = [];

  // criterion 0 — reach the target + open the interaction (prerequisites attach here).
  const coreCps = [...prereqOnly, ...core];
  if (coreCps.length > 0) {
    // every checkpoint this criterion covers must keep at least one of its own facts.
    const factIds = citedFactIds([...core, ...prereqOnly], 8);
    const transIds = usableTransitions(
      core.flatMap((c) => c.evidence.transitionIds),
      transitions,
    );
    criteria.push({
      index: 0,
      text: `${joinRequirements(coreCps)} — reaching "${entityLabel}" in the product's main experience`,
      evidenceText: `Describe how you reached "${entityLabel}" and what you saw when it opened (name the screen you came from).`,
      checkpointIds: coreCps.map((c) => c.checkpointId),
      factIds,
      transitionIds: transIds,
      evidenceMode: "observation",
      criterionKind: "state",
      stateId: factsStateId(facts, factIds),
      pageUrl: factsPageUrl(facts, factIds) ?? input.productUrl,
    });
  }

  // criterion 1 — supply the input + observe the result, with DISTINCT send/response evidence.
  if (outcomeGroup.length > 0) {
    const respCp =
      [...outcomeGroup].reverse().find((c) => c.kind === "outcome") ??
      outcomeGroup[outcomeGroup.length - 1];
    // the response state's evidence leads, but the send state keeps its own cited fact.
    const factIds = citedFactIds(
      [respCp, ...outcomeGroup.filter((c) => c !== respCp)],
      8,
    );
    criteria.push({
      index: criteria.length,
      text: `${joinRequirements(outcomeGroup)} — a NEW response from "${entityLabel}" that was not on screen before the message was sent`,
      evidenceText: `Quote the response "${entityLabel}" sent back to you, and say what you wrote to prompt it.`,
      checkpointIds: outcomeGroup.map((c) => c.checkpointId),
      factIds,
      transitionIds: usableTransitions(
        respCp.evidence.transitionIds,
        transitions,
      ),
      evidenceMode: "observation",
      criterionKind: "state",
      stateId: factsStateId(facts, respCp.evidence.factIds),
      pageUrl: factsPageUrl(facts, respCp.evidence.factIds) ?? input.productUrl,
    });
  }

  if (criteria.length === 0) return { ok: false, reason: "no_criteria" };

  // ── the compiled mission (prose is deterministic here; a model may refine it later) ────────────
  const stepsText = [
    ...prereqOnly.map(
      (c, i) =>
        `${i + 1}. ${titleCase(lower(c.requirement).replace(/\.$/, ""))}.`,
    ),
    ...core.map(
      (c, i) =>
        `${prereqOnly.length + i + 1}. ${titleCase(lower(c.requirement).replace(/\.$/, ""))} — look for "${entityLabel}".`,
    ),
    ...outcomeGroup.map(
      (c, i) =>
        `${prereqOnly.length + core.length + i + 1}. ${titleCase(lower(c.requirement).replace(/\.$/, ""))}.`,
    ),
  ].join("\n");

  const allFactIds = dedupe(criteria.flatMap((c) => c.factIds));
  const mission: CandidateMission = {
    missionKey: "founder-goal-journey",
    title: `Reach ${entityLabel} and have a real exchange`,
    objective: `Complete the founder's journey end to end: ${joinRequirements(cps).toLowerCase()}.`,
    instructions: `${stepsText}\n\nReport what actually happened in your own words — especially the response you received.`,
    targetSurface: input.productUrl,
    criteria: criteria.map((c) => c.text),
    evidenceRequirements: criteria.map((c) => c.evidenceText),
    whyItMatters: `This is exactly what the founder asked to be tested: ${journey.goal}`,
    sources: [
      { kind: "founder", ref: "goal", observation: journey.goal.slice(0, 200) },
    ],
    priority: "high",
    riskCategory: "critical_journey",
    effortMinutes: Math.min(20, 4 + cps.length * 2),
    conditions: [],
    rewardWeight: 5,
    maxCompletions: 1, // the sample policy sets the real number before budget compilation
    verificationMethod:
      "the observed state/action outcome described by the tester",
    confidence: 0.8,
    assumptions: [],
    disallowed: ["Do not sign up, pay, or share personal information."],
    anchors: anchorsFrom(facts, allFactIds, 3),
    verifiabilityClass: "observation-based",
    groundingV1: {
      version: "mission-grounding-v1",
      criteria: criteria.map<CriterionGroundingV1>((c) => ({
        criterionIndex: c.index,
        criterionKind: c.criterionKind,
        sourceFactIds: c.factIds,
        ...(c.transitionIds.length > 0
          ? { sourceTransitionIds: c.transitionIds }
          : {}),
        evidenceIndex: c.index,
        verificationMode: c.evidenceMode,
        ...(c.pageUrl ? { pageUrl: c.pageUrl } : {}),
        ...(c.stateId ? { stateId: c.stateId } : {}),
        supportRationale:
          "compiled deterministically from the founder journey's observed evidence",
      })),
    },
  };

  const mappings: CheckpointEvidenceMapping[] = criteria.flatMap((c) =>
    c.checkpointIds.map((id) => ({
      checkpointId: id,
      missionKey: mission.missionKey,
      criterionIndex: c.index,
      evidenceIndex: c.index,
      factIds:
        cps
          .find((x) => x.checkpointId === id)
          ?.evidence.factIds.filter((f) => c.factIds.includes(f)) ?? [],
      transitionIds: c.transitionIds,
      evidenceMode: c.evidenceMode,
    })),
  );

  return {
    ok: true,
    compiled: { mission, mappings, criteria, resolvedEntity },
  };
}

/** The core navigation checkpoint for the target entity (the one that REACHES it), when there is one. */
function targetCpOrCore(
  cps: GoalCheckpointV1[],
  targetCp: GoalCheckpointV1 | undefined,
): GoalCheckpointV1 | undefined {
  if (!targetCp) return undefined;
  const sameEntity = cps.filter(
    (c) =>
      c.targetEntity && lower(c.targetEntity) === lower(targetCp.targetEntity),
  );
  return (
    sameEntity.find(
      (c) => c.kind === "navigation" || c.kind === "interaction",
    ) ?? targetCp
  );
}

const dedupe = (xs: string[]) => [...new Set(xs.filter(Boolean))];
/** Only transitions Sage can actually cite (a non-safe one stays manual/lived and is omitted). */
function usableTransitions(
  ids: readonly string[],
  transitions: readonly ActionTransitionV1[],
): string[] {
  return dedupe(
    ids.filter(
      (id) =>
        transitions.find((t) => t.id === id)?.safeClassification === "safe",
    ),
  );
}
const factsStateId = (
  facts: readonly ObservedFactV1[],
  ids: readonly string[],
) =>
  ids
    .map((id) => facts.find((f) => f.id === id)?.stateId)
    .find((s): s is string => !!s);
const factsPageUrl = (
  facts: readonly ObservedFactV1[],
  ids: readonly string[],
) =>
  ids
    .map((id) => facts.find((f) => f.id === id)?.pageUrl)
    .find((s): s is string => !!s);

/* ───────────────── 3. optional prose refinement (model may polish only) ───── */

export interface ProseRefinement {
  title?: unknown;
  objective?: unknown;
  whyItMatters?: unknown;
  instructions?: unknown;
}

/**
 * Merge a model's PROSE refinement into a compiled mission. Only four human-readable fields may change,
 * and only when they are non-empty strings; criteria, evidence, ids, mappings, anchors and modes are
 * untouchable. Any failure keeps the deterministic copy — the grounded skeleton is never discarded.
 */
export function applyProseRefinement(
  mission: CandidateMission,
  prose: ProseRefinement | null | undefined,
): CandidateMission {
  if (!prose || typeof prose !== "object") return mission;
  const take = (v: unknown, max: number, fallback: string) =>
    typeof v === "string" && norm(v).length >= 8
      ? norm(v).slice(0, max)
      : fallback;
  return {
    ...mission,
    title: take(prose.title, 90, mission.title),
    objective: take(prose.objective, 300, mission.objective),
    whyItMatters: take(prose.whyItMatters, 300, mission.whyItMatters),
    instructions: take(prose.instructions, 1200, mission.instructions),
  };
}

/* ───────────────── 4. CompilerSupportProofV1 (recomputed, never trusted) ──── */

/** Bump when the compiler's derivation changes — an old proof can never validate against a new compiler. */
export const GOAL_MISSION_COMPILER_VERSION =
  "goal-mission-compiler-v1" as const;

/**
 * The deterministic proof that a mission's criteria were COMPILED by Sage from immutable observed inputs
 * — the thing that lets a compiled criterion stand without a model critic's blessing.
 *
 * It is never supplied by a model, an API caller, a database row or a persisted mission: it is computed
 * in-process from the compile inputs, and — crucially — {@link verifyCompilerSupportProof} RECOMPUTES the
 * whole compilation from those same immutable inputs and checks the final mission against it. A forged
 * proof, a forged provenance flag, an edited criterion, a swapped fact id, a different entity, a changed
 * mapping, a reworded mission, or a stale observation set all fail verification.
 */
export interface CompilerSupportProofV1 {
  version: "compiler-support-proof-v1";
  compilerVersion: typeof GOAL_MISSION_COMPILER_VERSION;
  /** the founder's compiled journey (goal + ordered checkpoints). */
  journeyDigest: string;
  /** the exact observation set the compilation was derived from. */
  observationSetDigest: string;
  /** where things were observed (phases + entity occurrences). */
  productContextDigest: string;
  /** the behaviourally-resolved target occurrence. */
  entityId: string | null;
  /** checkpoint → criterion/evidence mapping. */
  mappingsDigest: string;
  /** per-criterion evidence: fact ids, transition ids, evidence index and mode. */
  evidenceDigest: string;
  /** the FINAL mission (prose included) this proof was issued for. */
  missionDigest: string;
  /** sha over every field above. */
  proofDigest: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Canonical digest of the product context (phases + entity identity), order-independent. */
export function productContextDigest(context: ProductContextV1): string {
  return sha(
    JSON.stringify({
      v: context.version,
      p: context.statePhases,
      e: [...context.entities]
        .map((x) => [
          x.entityId,
          x.label,
          x.kind,
          x.phase,
          x.stateId,
          x.stateIndex,
          [...x.affordances].sort(),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      t: context.phaseTransitions.map((x) => [x.from, x.to, x.atStateIndex]),
    }),
  ).slice(0, 32);
}

/** Canonical digest of the FINAL mission — content AND prose. Any edit changes it. */
export function missionContentDigest(m: CandidateMission): string {
  return sha(
    JSON.stringify({
      k: m.missionKey,
      t: m.title,
      o: m.objective,
      i: m.instructions,
      w: m.whyItMatters,
      s: m.targetSurface,
      c: m.criteria,
      e: m.evidenceRequirements,
      a: m.anchors ?? [],
      v: m.verifiabilityClass ?? "",
      g: (m.groundingV1?.criteria ?? []).map((g) => [
        g.criterionIndex,
        g.evidenceIndex,
        [...g.sourceFactIds].sort(),
        [...(g.sourceTransitionIds ?? [])].sort(),
        g.verificationMode,
        g.criterionKind ?? "",
      ]),
    }),
  ).slice(0, 32);
}

const mappingsDigestOf = (
  mappings: readonly CheckpointEvidenceMapping[],
): string =>
  sha(
    JSON.stringify(
      [...mappings]
        .map((m) => [
          m.checkpointId,
          m.missionKey,
          m.criterionIndex,
          m.evidenceIndex,
          [...m.factIds].sort(),
          [...m.transitionIds].sort(),
          m.evidenceMode,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  ).slice(0, 32);

const evidenceDigestOf = (criteria: readonly CompiledCriterion[]): string =>
  sha(
    JSON.stringify(
      criteria.map((c) => [
        c.index,
        c.evidenceMode,
        c.criterionKind,
        [...c.factIds].sort(),
        [...c.transitionIds].sort(),
        [...c.checkpointIds].sort(),
      ]),
    ),
  ).slice(0, 32);

/** Issue the proof for a freshly compiled (and optionally prose-polished) mission. In-process only. */
export function buildCompilerSupportProof(args: {
  mission: CandidateMission;
  mappings: readonly CheckpointEvidenceMapping[];
  criteria: readonly CompiledCriterion[];
  resolvedEntity: EntityInstanceV1 | null;
  journey: GoalJourneyV1;
  context: ProductContextV1;
  observationSetDigest: string;
}): CompilerSupportProofV1 {
  const base = {
    version: "compiler-support-proof-v1" as const,
    compilerVersion: GOAL_MISSION_COMPILER_VERSION,
    journeyDigest: args.journey.digest,
    observationSetDigest: args.observationSetDigest,
    productContextDigest: productContextDigest(args.context),
    entityId: args.resolvedEntity?.entityId ?? null,
    mappingsDigest: mappingsDigestOf(args.mappings),
    evidenceDigest: evidenceDigestOf(args.criteria),
    missionDigest: missionContentDigest(args.mission),
  };
  return { ...base, proofDigest: sha(JSON.stringify(base)).slice(0, 32) };
}

export type ProofVerdict =
  | { ok: true; proof: CompilerSupportProofV1 }
  | { ok: false; code: "compiler_support_proof_invalid"; mismatch: string };

/**
 * RECOMPUTE the compilation from the immutable inputs and check the final mission + proof against it.
 * Nothing here is taken on trust: the criteria, evidence ids, mapping and entity are re-derived, and the
 * mission is re-digested. This is what makes a compiled criterion self-proving rather than flag-driven.
 */
export function verifyCompilerSupportProof(args: {
  mission: CandidateMission;
  proof: CompilerSupportProofV1 | null | undefined;
  input: CompileGoalInput;
  observationSetDigest: string;
}): ProofVerdict {
  const { mission, proof, input } = args;
  const fail = (mismatch: string): ProofVerdict => ({
    ok: false,
    code: "compiler_support_proof_invalid",
    mismatch,
  });
  if (!proof || proof.version !== "compiler-support-proof-v1")
    return fail("absent");
  if (proof.compilerVersion !== GOAL_MISSION_COMPILER_VERSION)
    return fail("compiler_version");
  // 1. the proof must be internally consistent (a hand-edited field breaks its own digest).
  const { proofDigest, ...body } = proof;
  if (sha(JSON.stringify(body)).slice(0, 32) !== proofDigest)
    return fail("proof_digest");
  // 2. the immutable inputs must be the ones the proof was issued against.
  if (proof.journeyDigest !== input.journey.digest)
    return fail("journey_digest");
  if (proof.observationSetDigest !== args.observationSetDigest)
    return fail("observation_set_digest");
  if (proof.productContextDigest !== productContextDigest(input.context))
    return fail("product_context_digest");
  // 3. RECOMPUTE the compilation — the criteria/evidence/mapping/entity must be exactly what Sage derives.
  const recomputed = compileGoalMission(input);
  if (!recomputed.ok) return fail(`recompile_failed:${recomputed.reason}`);
  const r = recomputed.compiled;
  if ((r.resolvedEntity?.entityId ?? null) !== proof.entityId)
    return fail("entity_id");
  if (mappingsDigestOf(r.mappings) !== proof.mappingsDigest)
    return fail("mappings");
  if (evidenceDigestOf(r.criteria) !== proof.evidenceDigest)
    return fail("evidence");
  // 4. the FINAL mission must be the one the proof was issued for, and structurally identical to the
  //    recomputation (prose may differ from the raw skeleton, but not from what the proof committed to).
  if (missionContentDigest(mission) !== proof.missionDigest)
    return fail("mission_digest");
  const structural = (m: CandidateMission) =>
    JSON.stringify({
      k: m.missionKey,
      c: m.criteria,
      e: m.evidenceRequirements,
      g: (m.groundingV1?.criteria ?? []).map((g) => [
        g.criterionIndex,
        g.evidenceIndex,
        [...g.sourceFactIds].sort(),
        g.verificationMode,
      ]),
    });
  if (structural(mission) !== structural(r.mission))
    return fail("mission_structure");
  return { ok: true, proof };
}
