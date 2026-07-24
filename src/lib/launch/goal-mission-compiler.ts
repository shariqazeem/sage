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

const pick = <T>(xs: readonly T[], n: number): T[] =>
  xs.slice(0, Math.max(0, n));

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
    const factIds = dedupe([
      ...pick(
        core.flatMap((c) => c.evidence.factIds),
        4,
      ),
      ...prereqOnly.flatMap((c) => pick(c.evidence.factIds, 2)),
    ]).slice(0, 8);
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
    const sendCp = outcomeGroup.find((c) => c.kind === "input");
    const respCp =
      [...outcomeGroup].reverse().find((c) => c.kind === "outcome") ??
      outcomeGroup[outcomeGroup.length - 1];
    const sendIds = sendCp ? pick(sendCp.evidence.factIds, 3) : [];
    const respIds = pick(respCp.evidence.factIds, 4);
    const factIds = dedupe([...respIds, ...sendIds]).slice(0, 8);
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
      stateId: factsStateId(facts, respIds),
      pageUrl: factsPageUrl(facts, respIds) ?? input.productUrl,
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
