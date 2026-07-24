import "server-only";

import { createHash } from "node:crypto";
import { llmCompleteJson } from "@/lib/llm/complete";
import { missionModel } from "@/lib/llm/mission-model";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import {
  instancesOf,
  phaseAtLeast,
  type ExperiencePhase,
  type ProductContextV1,
} from "./product-context";

/**
 * GoalJourneyV1 — the founder's natural-language request compiled into an ORDERED journey of required
 * checkpoints, so Sage can never mistake a prerequisite (or an early mention of an entity) for the
 * founder's actual goal.
 *
 * "go to the X character and talk to her" is not satisfied by seeing the word X on the splash screen, nor
 * by an onboarding mission: the LATER checkpoints (locate X in the main experience, open the conversation,
 * send a message, observe the response) are still unmet. This module makes that structural rather than a
 * matter of text similarity:
 *
 *   · The MODEL only proposes the semantic decomposition (kind / requirement / entity / context / order).
 *     Every id is minted HERE, the order is re-derived HERE, and each checkpoint's `sourcePhrase` must be
 *     verbatim founder text — anything invented is dropped.
 *   · Completion is EVIDENCE-based: a checkpoint becomes `observed` only when real ObservedFact /
 *     ActionTransition ids support it, in dependency order. Text similarity alone can never complete one.
 *   · The gate then requires every founder-required checkpoint to be covered by the mission plan, so a
 *     truthful-but-partial (prerequisite-only) plan is blocked instead of being presented as the answer.
 *
 * Product-agnostic by construction: no product names, no per-product strings — the journey comes from the
 * founder's own words, and the evaluator reasons over kinds + observed evidence.
 */

export const GOAL_JOURNEY_VERSION = "goal-journey-v1" as const;

/** What kind of requirement a checkpoint expresses (ordered lifecycle of any product journey). */
export type CheckpointKind =
  | "entry" // reach the product itself
  | "navigation" // move to a place/section/screen
  | "state" // a particular state/screen must be reached
  | "interaction" // act on a specific thing (open/click/select it)
  | "input" // supply something (a message, a search, a choice)
  | "outcome" // an observable result the founder asked for
  | "experience"; // a qualitative experience the founder wants exercised

export type CheckpointStatus = "unmet" | "observed" | "blocked";

export interface GoalCheckpointV1 {
  /** Sage-minted, deterministic. Never model-authored. */
  checkpointId: string;
  kind: CheckpointKind;
  /** one concise sentence: what must be true. */
  requirement: string;
  /** the entity this checkpoint is about (a character, a page, a control, a feature) — "" when none. */
  targetEntity: string;
  /** the context the requirement must hold IN (e.g. "the main walkable world"), "" when unconstrained. */
  requiredContext: string;
  /** checkpointIds that must be `observed` first — order is structural, not advisory. */
  dependsOn: string[];
  /** EXACT substring of the founder's request that demands this checkpoint (verbatim; never paraphrased). */
  sourcePhrase: string;
  /** the observed evidence that completed it (empty while unmet). */
  evidence: { factIds: string[]; transitionIds: string[] };
  status: CheckpointStatus;
  /** bounded reason when blocked. */
  blockedReason?: string;
  /** the product PHASE this requirement must hold in — an onboarding occurrence can never satisfy a
   *  main-experience requirement. Derived deterministically from the checkpoint kind + the founder's
   *  stated action, never model-authored. */
  requiredPhase?: ExperiencePhase;
  /** the specific observed entity OCCURRENCE this checkpoint was bound to (null until bound). */
  boundEntityId?: string | null;
}

export interface GoalJourneyV1 {
  version: typeof GOAL_JOURNEY_VERSION;
  /** the founder's goal this journey was compiled from (verbatim). */
  goal: string;
  checkpoints: GoalCheckpointV1[];
  /** deterministic digest over the compiled journey (ids + kinds + requirements). */
  digest: string;
  /** the model that proposed the decomposition (provenance only). */
  model: string | null;
  provider: string | null;
}

/** Bounded rejection codes — why a grounded plan may not be selected against the founder's journey. */
export type JourneyRejectionCode =
  | "goal_checkpoint_unobserved" // Sage never observed this checkpoint in the browser
  | "goal_checkpoint_wrong_context" // observed, but not in the context the founder required
  | "goal_checkpoint_uncovered" // observed, but no mission criterion covers it
  | "goal_outcome_uncovered" // the founder's asked-for OUTCOME is not covered by any criterion
  | "prerequisite_only_plan" // the plan covers only prerequisites, not the requested outcome
  | "goal_entity_wrong_phase" // the entity was only seen in an earlier phase (e.g. onboarding, not in-world)
  | "goal_entity_instance_mismatch" // a different OCCURRENCE of the entity than the founder's context implies
  | "goal_checkpoint_evidence_unmapped" // no criterion+evidence pair is grounded on this checkpoint's evidence
  | "goal_outcome_evidence_insufficient"; // the outcome's criterion is not tied to the observed result state

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const lower = (s: string) => norm(s).toLowerCase();

/* ────────────────────────── compile (model proposes, Sage disposes) ───────── */

const JOURNEY_SYSTEM = [
  "You decompose a founder's product-testing request into an ORDERED journey of required checkpoints.",
  "Return every step a first-time user must complete, in order, from arriving at the product to the founder's final asked-for outcome.",
  "Preserve EVERY action, entity and outcome the founder stated — never drop the final outcome, and never add goals they did not ask for.",
  "Each checkpoint: kind (entry|navigation|state|interaction|input|outcome|experience), a one-sentence requirement, the target entity ('' if none), the required context it must happen in ('' if unconstrained), the 1-based indexes of earlier checkpoints it depends on, and sourcePhrase — an EXACT VERBATIM substring of the founder's request that demands this checkpoint (copy it character-for-character; never paraphrase).",
  "Include the implicit steps a real product requires (arriving, passing any onboarding/intro, reaching the main experience) as separate earlier checkpoints, before the explicitly named ones.",
  "If the founder asks to talk/message/ask something, ALWAYS emit both an input checkpoint (send the message) and a separate outcome checkpoint (observe the response).",
  "Order matters: an entity mentioned early is not reached until its own checkpoint.",
  "These are END-USER journey steps (what a person does in the product), NEVER engineering/build tasks.",
  'Output JSON ONLY, exactly this shape: {"checkpoints":[{"kind":"entry","requirement":"...","targetEntity":"...","requiredContext":"...","dependsOnIndexes":[],"sourcePhrase":"..."}]}.',
  'Worked example — request "let people open the dashboard and export a report": {"checkpoints":[' +
    '{"kind":"entry","requirement":"Open the product","targetEntity":"","requiredContext":"","dependsOnIndexes":[],"sourcePhrase":"open the dashboard"},' +
    '{"kind":"navigation","requirement":"Reach the dashboard","targetEntity":"dashboard","requiredContext":"","dependsOnIndexes":[1],"sourcePhrase":"open the dashboard"},' +
    '{"kind":"interaction","requirement":"Start the report export","targetEntity":"report","requiredContext":"dashboard","dependsOnIndexes":[2],"sourcePhrase":"export a report"},' +
    '{"kind":"outcome","requirement":"The exported report is produced","targetEntity":"report","requiredContext":"","dependsOnIndexes":[3],"sourcePhrase":"export a report"}]}',
].join(" ");

/** Provider-native transport schema (strict) — the model fills ONLY semantics; ids/order are minted here. */
export const GOAL_JOURNEY_TRANSPORT_SCHEMA: {
  name: string;
  schema: Record<string, unknown>;
} = {
  name: "sage_goal_journey_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      checkpoints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: [
                "entry",
                "navigation",
                "state",
                "interaction",
                "input",
                "outcome",
                "experience",
              ],
            },
            requirement: { type: "string" },
            targetEntity: { type: "string" },
            requiredContext: { type: "string" },
            dependsOnIndexes: { type: "array", items: { type: "integer" } },
            sourcePhrase: { type: "string" },
          },
          required: [
            "kind",
            "requirement",
            "targetEntity",
            "requiredContext",
            "dependsOnIndexes",
            "sourcePhrase",
          ],
        },
      },
    },
    required: ["checkpoints"],
  },
};

const MAX_CHECKPOINTS = 12;

interface RawCheckpoint {
  kind?: unknown;
  requirement?: unknown;
  targetEntity?: unknown;
  requiredContext?: unknown;
  dependsOnIndexes?: unknown;
  sourcePhrase?: unknown;
}

const KINDS = new Set<CheckpointKind>([
  "entry",
  "navigation",
  "state",
  "interaction",
  "input",
  "outcome",
  "experience",
]);

/**
 * Deterministically turn a raw model decomposition into a GoalJourneyV1: mint ids, clamp the count, force a
 * strictly increasing dependency chain (a checkpoint may only depend on EARLIER ones), and keep a
 * `sourcePhrase` only when it is genuinely verbatim founder text. Pure — no network. Exported for tests.
 */
export function compileJourneyFromRaw(
  goal: string,
  raw: unknown,
  model: string | null = null,
  provider: string | null = null,
): GoalJourneyV1 | null {
  const list = extractCheckpointList(raw);
  if (!Array.isArray(list) || list.length === 0) return null;
  const goalLower = lower(goal);
  const checkpoints: GoalCheckpointV1[] = [];
  list.slice(0, MAX_CHECKPOINTS).forEach((item, i) => {
    const r = (item ?? {}) as RawCheckpoint;
    const kindRaw = (
      typeof r.kind === "string"
        ? r.kind
        : (item as Record<string, unknown>)?.type
    ) as CheckpointKind;
    const kind = KINDS.has(kindRaw) ? kindRaw : "state";
    const rec = r as unknown as Record<string, unknown>;
    const requirement = norm(
      pick(rec, [
        "requirement",
        "task",
        "step",
        "goal",
        "title",
        "description",
      ]),
    ).slice(0, 200);
    if (!requirement) return;
    // the source phrase must be REAL founder text — an invented justification is dropped, never kept.
    const rawPhrase = norm(
      pick(rec, ["sourcePhrase", "source", "phrase", "quote"]),
    );
    const sourcePhrase =
      rawPhrase && goalLower.includes(lower(rawPhrase))
        ? rawPhrase.slice(0, 200)
        : "";
    // dependencies: only on strictly EARLIER checkpoints (the model cannot invent a cycle or a forward dep).
    const depsRaw = rec.dependsOnIndexes ?? rec.dependsOn ?? rec.dependencies;
    const deps = Array.isArray(depsRaw) ? depsRaw : [];
    const depIds = deps
      .map((d) => (typeof d === "number" ? Math.round(d) : NaN))
      .filter((d) => Number.isFinite(d) && d >= 1 && d <= i) // 1-based, strictly earlier
      .map((d) => checkpointId(goal, d - 1));
    const id = checkpointId(goal, i);
    // every checkpoint also depends on its immediate predecessor: the journey is ORDERED by construction,
    // so a later requirement can never be satisfied before the step that makes it reachable.
    const prev = i > 0 ? checkpointId(goal, i - 1) : null;
    const dependsOn = [...new Set([...(prev ? [prev] : []), ...depIds])];
    checkpoints.push({
      checkpointId: id,
      kind,
      requirement,
      targetEntity: norm(pick(rec, ["targetEntity", "entity", "target"])).slice(
        0,
        80,
      ),
      requiredContext: norm(
        pick(rec, ["requiredContext", "context", "where"]),
      ).slice(0, 120),
      dependsOn,
      sourcePhrase,
      evidence: { factIds: [], transitionIds: [] },
      status: "unmet",
    });
  });
  if (checkpoints.length === 0) return null;
  return {
    version: GOAL_JOURNEY_VERSION,
    goal: norm(goal).slice(0, 1200),
    checkpoints,
    digest: journeyDigest(checkpoints),
    model,
    provider,
  };
}

/**
 * Find the checkpoint list in a model reply. Providers do not reliably honour a strict json_schema (this
 * gateway renames keys), so the list is taken from `checkpoints` when present, else from the object's ONLY
 * array-of-objects property. This tolerance is safe because nothing here is trusted: ids, ordering,
 * dependencies and the verbatim sourcePhrase are all re-derived deterministically below.
 */
function extractCheckpointList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.checkpoints)) return obj.checkpoints;
  const arrays = Object.values(obj).filter(
    (v): v is unknown[] =>
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === "object" &&
      v[0] !== null,
  );
  return arrays.length === 1 ? arrays[0] : null;
}

/** Read a field under any of its known spellings (the provider renames keys); "" when absent. */
function pick(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/** Deterministic checkpoint id — a function of the goal + position, never model-authored. */
function checkpointId(goal: string, index: number): string {
  return `cp${index + 1}_${sha(`${GOAL_JOURNEY_VERSION}|${lower(goal)}|${index}`).slice(0, 8)}`;
}

function journeyDigest(cps: GoalCheckpointV1[]): string {
  return sha(
    JSON.stringify(
      cps.map((c) => [
        c.checkpointId,
        c.kind,
        lower(c.requirement),
        lower(c.targetEntity),
        lower(c.requiredContext),
        c.dependsOn,
      ]),
    ),
  ).slice(0, 24);
}

export interface JourneyDeps {
  /** test seam: replace the model call. Returns the raw decomposition object. */
  complete?: (
    system: string,
    user: string,
  ) => Promise<{
    json: unknown;
    model: string | null;
    provider: string | null;
  }>;
  model?: string;
}

/**
 * Compile the founder's request into an ordered journey using the existing cheap text-model path with
 * strict structured parsing. Returns null when the model is unconfigured or the output is unusable — the
 * caller then behaves exactly as before (honest degradation; the journey gate simply does not apply).
 */
export async function compileGoalJourney(
  goal: string,
  deps: JourneyDeps = {},
): Promise<GoalJourneyV1 | null> {
  const clean = norm(goal);
  if (!clean) return null;
  const user = `FOUNDER REQUEST (verbatim):\n<<<UNTRUSTED_FOUNDER_GOAL\n${clean.slice(0, 1200)}\n>>>\n\nDecompose it into the ordered checkpoints a first-time user must complete.`;
  try {
    if (deps.complete) {
      const r = await deps.complete(JOURNEY_SYSTEM, user);
      return compileJourneyFromRaw(clean, r.json, r.model, r.provider);
    }
    const r = await llmCompleteJson({
      system: JOURNEY_SYSTEM,
      user,
      maxTokens: 1200,
      temperature: 0,
      model: deps.model ?? missionModel(),
      parsePolicy: "strict",
      responseSchema: GOAL_JOURNEY_TRANSPORT_SCHEMA,
    });
    return compileJourneyFromRaw(
      clean,
      r.json,
      r.responseModel ?? r.model,
      r.provider,
    );
  } catch {
    return null; // unconfigured / provider failure → degrade honestly (no journey gating)
  }
}

/* ───────────── product-context binding (phase + entity INSTANCE identity) ─── */

/** The phase a checkpoint's requirement must hold in — derived from its kind + whether it names an entity. */
export function requiredPhaseFor(
  cp: GoalCheckpointV1,
  index: number,
): ExperiencePhase {
  if (cp.kind === "entry" || index === 0) return "entry";
  switch (cp.kind) {
    case "state":
      return "onboarding";
    case "navigation":
    case "interaction":
    case "experience":
      // "go to X" / "open X" is about the product's real experience, not the intro that merely mentions X.
      return cp.targetEntity ? "main_experience" : "onboarding";
    case "input":
    case "outcome":
      return "main_experience";
    default:
      return "onboarding";
  }
}

export interface JourneyBindingResult {
  journey: GoalJourneyV1;
  /** ONE concise founder question when an entity's meaning is genuinely ambiguous (never a silent pick). */
  question: string | null;
  /** bounded reasons a checkpoint could not be bound. */
  rejections: Array<{
    code: JourneyRejectionCode;
    checkpointId: string;
    requirement: string;
  }>;
}

/**
 * Bind each checkpoint to the product context: the phase it must hold in, and the specific observed entity
 * OCCURRENCE it refers to. Two occurrences of the same label in different phases are different instances —
 * so an onboarding mention can never be the in-world thing the founder asked for. When several occurrences
 * are equally plausible IN the required phase, Sage asks ONE question instead of picking the easiest.
 * Pure + deterministic.
 */
export function bindJourneyToContext(
  journey: GoalJourneyV1,
  context: ProductContextV1,
): JourneyBindingResult {
  const rejections: JourneyBindingResult["rejections"] = [];
  let question: string | null = null;
  const checkpoints = journey.checkpoints.map((cp, i) => {
    const requiredPhase = requiredPhaseFor(cp, i);
    // The ENTRY checkpoint is about arriving at the product itself (its domain), not about any in-world
    // occurrence — binding it to one would be a category error (and a false ambiguity).
    if (!cp.targetEntity || requiredPhase === "entry")
      return { ...cp, requiredPhase, boundEntityId: null };
    const all = instancesOf(context, cp.targetEntity);
    const inPhase = all.filter((e) => phaseAtLeast(e.phase, requiredPhase));
    if (all.length > 0 && inPhase.length === 0) {
      // seen — but only BEFORE the phase the founder's action requires (e.g. named during onboarding).
      rejections.push({
        code: "goal_entity_wrong_phase",
        checkpointId: cp.checkpointId,
        requirement: cp.requirement,
      });
      return { ...cp, requiredPhase, boundEntityId: null };
    }
    if (inPhase.length === 0)
      return { ...cp, requiredPhase, boundEntityId: null };
    // prefer an exact label match; else a single candidate; else ask.
    const wanted = lower(cp.targetEntity);
    const exact = inPhase.filter((e) => lower(e.label) === wanted);
    const interactive = inPhase.filter((e) => e.affordances.length > 0);
    const pool =
      exact.length > 0 ? exact : interactive.length > 0 ? interactive : inPhase;
    const distinctLabels = new Set(pool.map((e) => lower(e.label)));
    if (distinctLabels.size > 1 && exact.length === 0) {
      question =
        question ??
        `Sage saw more than one thing matching "${cp.targetEntity}" in the product (${[...distinctLabels].slice(0, 3).join(", ")}). Which one did you mean for "${cp.requirement}"?`;
      rejections.push({
        code: "goal_entity_instance_mismatch",
        checkpointId: cp.checkpointId,
        requirement: cp.requirement,
      });
      return { ...cp, requiredPhase, boundEntityId: null };
    }
    return { ...cp, requiredPhase, boundEntityId: pool[0]?.entityId ?? null };
  });
  return { journey: { ...journey, checkpoints }, question, rejections };
}

/* ─────────────────────── the next unmet checkpoint (browser driver) ────────── */

/** The next checkpoint Sage should pursue: the first `unmet` one whose dependencies are all observed. */
export function nextUnmetCheckpoint(
  journey: GoalJourneyV1 | null | undefined,
): GoalCheckpointV1 | null {
  if (!journey) return null;
  const byId = new Map(journey.checkpoints.map((c) => [c.checkpointId, c]));
  for (const c of journey.checkpoints) {
    if (c.status !== "unmet") continue;
    const ready = c.dependsOn.every((d) => byId.get(d)?.status === "observed");
    if (ready) return c;
  }
  return null;
}

/** All checkpoints the founder's request requires (everything compiled is required — nothing is optional). */
export function requiredCheckpoints(
  journey: GoalJourneyV1,
): GoalCheckpointV1[] {
  return journey.checkpoints;
}

/** The founder's asked-for OUTCOME checkpoints (the last outcome, else the final checkpoint). */
export function outcomeCheckpoints(journey: GoalJourneyV1): GoalCheckpointV1[] {
  const outcomes = journey.checkpoints.filter((c) => c.kind === "outcome");
  if (outcomes.length > 0) return outcomes;
  const last = journey.checkpoints[journey.checkpoints.length - 1];
  return last ? [last] : [];
}

/* ───────────────── evidence-based evaluation (never text similarity alone) ─── */

/** One observed browser step, as the evaluator sees it — minted by Sage, never by the product. */
export interface JourneyStep {
  /** index of the state this step produced. */
  stateIndex: number;
  /** what Sage did to produce it (structured, from the controller — not parsed English). */
  actionKind:
    | "load"
    | "click"
    | "key"
    | "type"
    | "submit"
    | "observe_response"
    | "scroll"
    | "drag"
    | "wait"
    | "back";
  /** the label/entity Sage acted on, when the action targeted a named affordance. */
  actedLabel: string;
  /** the visible text of the resulting state. */
  stateText: string;
  /** text that APPEARED in this state versus the previous one (the real change). */
  addedText: string;
  /** true when the state observably differed from the previous one. */
  observableChange: boolean;
  /** ids of the observed facts belonging to this state. */
  factIds: string[];
  /** id of the transition that produced this state, when there was one. */
  transitionId: string | null;
  /** which product phase this state belongs to (from the product context). */
  phase?: ExperiencePhase;
  /** the entity OCCURRENCE Sage acted on in this step, when it acted on a named thing. */
  actedEntityId?: string | null;
}

const containsAll = (haystack: string, needle: string): boolean => {
  const words = lower(needle)
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  const hay = lower(haystack);
  return words.every((w) => hay.includes(w));
};
const containsAny = (haystack: string, needle: string): boolean => {
  const words = lower(needle)
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  const hay = lower(haystack);
  return words.some((w) => hay.includes(w));
};

/**
 * Can this step COMPLETE this checkpoint? Evidence rules by kind — deterministic and product-agnostic.
 * The common thread: a checkpoint about DOING something needs a real action + an observable change; a
 * checkpoint about an ENTITY needs Sage to have acted on that entity (or the entity to appear as a RESULT
 * of an action), never merely to have seen its name on an earlier screen.
 */
function stepCompletes(
  cp: GoalCheckpointV1,
  step: JourneyStep,
  prior: JourneyStep[],
): boolean {
  // PHASE GUARD — a requirement bound to a product phase can only be completed by a state in that phase
  // (or deeper). This is what stops an onboarding occurrence of an entity satisfying "go to [entity]".
  if (
    cp.requiredPhase &&
    step.phase &&
    !phaseAtLeast(step.phase, cp.requiredPhase)
  )
    return false;
  // INSTANCE GUARD — when the checkpoint was bound to a specific observed occurrence, acting on a
  // different occurrence of the same label does not complete it.
  if (
    cp.boundEntityId &&
    step.actedEntityId &&
    step.actedEntityId !== cp.boundEntityId
  )
    return false;
  const entity = cp.targetEntity;
  const ctx = cp.requiredContext;
  // the context, when the founder required one, must be present in the state Sage is in.
  const contextOk =
    !ctx ||
    containsAny(step.stateText, ctx) ||
    containsAny(step.addedText, ctx);
  switch (cp.kind) {
    case "entry":
      // arriving at the product: the first real load.
      return step.actionKind === "load" && step.stateText.length > 0;
    case "navigation":
    case "state":
    case "experience": {
      // a place/screen is REACHED by an action that observably changed the view (not by reading a word).
      if (!step.observableChange || step.actionKind === "load") return false;
      if (!contextOk) return false;
      // when an entity is named, it must be present in what the action REVEALED, or have been acted on.
      if (!entity) return true;
      return (
        containsAny(step.addedText, entity) ||
        containsAny(step.actedLabel, entity) ||
        containsAny(step.stateText, entity)
      );
    }
    case "interaction": {
      // Sage must have ACTED on the entity itself (clicked/opened it) and something must have changed.
      if (
        step.actionKind !== "click" &&
        step.actionKind !== "key" &&
        step.actionKind !== "drag"
      )
        return false;
      if (!step.observableChange) return false;
      if (!contextOk) return false;
      return (
        !entity ||
        containsAny(step.actedLabel, entity) ||
        containsAll(step.addedText, entity)
      );
    }
    case "input":
      // something was actually supplied + submitted.
      return step.actionKind === "type" || step.actionKind === "submit";
    case "outcome": {
      // the founder's asked-for RESULT: new content that appeared AFTER an input was supplied.
      const suppliedBefore = prior.some(
        (p) => p.actionKind === "type" || p.actionKind === "submit",
      );
      if (!suppliedBefore)
        return step.observableChange && step.addedText.length > 0 && contextOk;
      return (
        (step.actionKind === "observe_response" || step.observableChange) &&
        step.addedText.length > 0
      );
    }
  }
}

/**
 * Walk the observed steps IN ORDER and mark checkpoints observed as their evidence appears. Strictly
 * sequential: a checkpoint is only considered once every dependency is observed, so an entity mentioned
 * during onboarding can never satisfy a later "find that entity" checkpoint. Pure.
 */
export function evaluateJourney(
  journey: GoalJourneyV1,
  steps: JourneyStep[],
): GoalJourneyV1 {
  const checkpoints = journey.checkpoints.map((c) => ({
    ...c,
    evidence: {
      factIds: [...c.evidence.factIds],
      transitionIds: [...c.evidence.transitionIds],
    },
  }));
  const byId = new Map(checkpoints.map((c) => [c.checkpointId, c]));
  let cursor = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // advance past anything already observed
    while (
      cursor < checkpoints.length &&
      checkpoints[cursor].status === "observed"
    )
      cursor++;
    if (cursor >= checkpoints.length) break;
    // ONE action may legitimately satisfy consecutive checkpoints (clicking a character both LOCATES it
    // and OPENS it), so keep advancing while this same step independently satisfies the next requirement.
    // Each checkpoint's own rule must still hold — a click never satisfies "send a message".
    const prior = steps.slice(0, i);
    while (cursor < checkpoints.length) {
      const cp = checkpoints[cursor];
      if (cp.status === "observed") {
        cursor++;
        continue;
      }
      const depsOk = cp.dependsOn.every(
        (d) => byId.get(d)?.status === "observed",
      );
      if (!depsOk) break;
      if (!stepCompletes(cp, step, prior)) break;
      cp.status = "observed";
      cp.evidence = {
        factIds: step.factIds.slice(0, 8),
        transitionIds: step.transitionId ? [step.transitionId] : [],
      };
      cursor++;
    }
  }
  return { ...journey, checkpoints };
}

/**
 * Rebuild the ordered evidence steps from the PERSISTED field-test states + the derived observation set —
 * deterministic and pure, so the browser run and any later re-evaluation always agree. Facts are attached
 * by state, transitions by their recorded provenance (which after-state they produced).
 */
export function buildJourneySteps(
  states: Array<{
    trigger: string;
    visibleTextExcerpt: string;
    pixelDeltaPct: number;
    actionKind?: JourneyStep["actionKind"];
    actedLabel?: string;
  }>,
  facts: readonly ObservedFactV1[],
  transitions: readonly ActionTransitionV1[],
  stateIds: readonly string[],
): JourneyStep[] {
  const factsByState = new Map<string, string[]>();
  for (const f of facts) {
    if (!f.stateId) continue;
    const arr = factsByState.get(f.stateId) ?? [];
    arr.push(f.id);
    factsByState.set(f.stateId, arr);
  }
  const transitionByTo = new Map<number, ActionTransitionV1>();
  for (const t of transitions) transitionByTo.set(t.provenance.toStateIndex, t);

  return states.map((s, i) => {
    const prevTexts =
      i > 0
        ? new Set(splitLines(states[i - 1].visibleTextExcerpt))
        : new Set<string>();
    const added = splitLines(s.visibleTextExcerpt).filter(
      (l) => !prevTexts.has(l),
    );
    const t = transitionByTo.get(i) ?? null;
    return {
      stateIndex: i,
      actionKind: s.actionKind ?? inferActionKind(s.trigger, i),
      actedLabel: s.actedLabel ?? extractQuoted(s.trigger),
      stateText: s.visibleTextExcerpt ?? "",
      addedText: added.join(" "),
      observableChange: t
        ? t.observableChange
        : added.length > 0 || (s.pixelDeltaPct ?? 0) >= 3,
      factIds: factsByState.get(stateIds[i] ?? "") ?? [],
      transitionId: t?.id ?? null,
    };
  });
}

const splitLines = (s: string): string[] =>
  norm(s ?? "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(norm)
    .filter(Boolean);
const extractQuoted = (trigger: string): string =>
  /['"]([^'"]+)['"]/.exec(trigger ?? "")?.[1] ?? "";
/** Legacy fallback for states captured before `actionKind` existed (never used for new runs). */
function inferActionKind(
  trigger: string,
  index: number,
): JourneyStep["actionKind"] {
  const t = lower(trigger ?? "");
  if (index === 0 || t.includes("initial load")) return "load";
  if (t.includes("typed")) return "type";
  if (t.includes("sent the message") || t.includes("to send the message"))
    return "submit";
  if (t.includes("observed the reply")) return "observe_response";
  if (t.includes("pressed")) return "key";
  if (t.includes("scroll")) return "scroll";
  if (t.includes("drag") || t.includes("drew")) return "drag";
  if (t.includes("went back")) return "back";
  if (t.includes("waited")) return "wait";
  return "click";
}

/* ───────────────────────────── the coverage gate ──────────────────────────── */

export interface JourneyCoverageResult {
  ok: boolean;
  /** the explicit checkpoint → criterion → evidence mappings that satisfied the gate. */
  mappings: CheckpointEvidenceMapping[];
  /** bounded rejection codes with the checkpoint they refer to. */
  rejections: Array<{
    code: JourneyRejectionCode;
    checkpointId: string;
    requirement: string;
  }>;
  observedCount: number;
  requiredCount: number;
  coveredCount: number;
}

/** A mission's criteria + evidence text, as the gate sees them (no model involvement). */
export interface CriterionGroundingView {
  criterionIndex: number;
  /** the evidenceRequirements[] index that PROVES this criterion. */
  evidenceIndex: number;
  /** observed fact ids this criterion is grounded on. */
  factIds: string[];
  /** observed transition ids this criterion is grounded on (when the criterion is about a change). */
  transitionIds: string[];
  /** how the criterion can be proven (deterministic_url | semantic_url | observation). */
  evidenceMode: string;
}

export interface MissionCoverageView {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  criteria: string[];
  evidenceRequirements: string[];
  /** per-criterion grounding — the ONLY thing that can prove a checkpoint (title/objective text cannot). */
  grounding: CriterionGroundingView[];
  /** prerequisite text attached to criteria (conditions/assumptions) — may SUPPORT but never SUBSTITUTE. */
  prerequisites: string[];
}

/** An explicit checkpoint → criterion → evidence mapping. A checkpoint is only covered when one exists. */
export interface CheckpointEvidenceMapping {
  checkpointId: string;
  missionKey: string;
  criterionIndex: number;
  evidenceIndex: number;
  factIds: string[];
  transitionIds: string[];
  evidenceMode: string;
}

/** A looser requirement match: the checkpoint's distinctive words, else a verb from its kind's family. */
function coversByKeywords(hay: string, cp: GoalCheckpointV1): boolean {
  const bits = [cp.targetEntity, cp.requiredContext].filter(Boolean).join(" ");
  const tokens = distinctiveTokens(`${cp.requirement} ${cp.targetEntity}`);
  if (tokens.length > 0) {
    const h = lower(hay);
    const hit = tokens.filter((t) => h.includes(t)).length;
    if (hit / tokens.length >= 0.5) return true;
  }
  const verbs: Record<CheckpointKind, string[]> = {
    entry: [
      "open",
      "visit",
      "go to",
      "land",
      "navigate",
      "load",
      "arrive",
      "browse",
      "start at",
    ],
    navigation: [
      "navigate",
      "go to",
      "reach",
      "enter",
      "move",
      "find",
      "locate",
      "get to",
      "open",
    ],
    state: [
      "reach",
      "see",
      "arrive",
      "screen",
      "state",
      "view",
      "appear",
      "display",
    ],
    interaction: [
      "open",
      "click",
      "select",
      "start",
      "tap",
      "activate",
      "engage",
      "interact",
      "initiate",
    ],
    input: [
      "send",
      "type",
      "enter",
      "message",
      "submit",
      "ask",
      "write",
      "say",
      "post",
      "initiate",
    ],
    outcome: [
      "response",
      "reply",
      "answer",
      "respond",
      "receive",
      "result",
      "back",
      "returns",
      "confirms",
    ],
    experience: ["experience", "explore", "try", "use", "play", "feel"],
  };
  const verbHit = verbs[cp.kind].some((v) => lower(hay).includes(v));
  const bitsHit = !bits || containsAny(hay, bits);
  return verbHit && bitsHit;
}

/** Words that carry the checkpoint's meaning (drops filler so matching is phrasing-robust). */
const REQUIREMENT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "that",
  "this",
  "their",
  "there",
  "her",
  "his",
  "its",
  "your",
  "you",
  "she",
  "him",
  "who",
  "was",
  "are",
  "can",
  "will",
  "would",
  "should",
  "must",
  "user",
  "users",
  "tester",
  "testers",
  "person",
  "people",
  "visitor",
  "visitors",
  "first",
  "time",
  "product",
  "site",
  "website",
  "page",
  "app",
  "screen",
  "within",
  "using",
  "via",
  "then",
  "after",
]);
function distinctiveTokens(str: string): string[] {
  const words = lower(str)
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((w) => w.length >= 4 && !REQUIREMENT_STOPWORDS.has(w));
  return [...new Set(words)];
}

/**
 * Map ONE checkpoint to the criterion+evidence pair that PROVES it. Coverage is judged per criterion —
 * never over concatenated title/objective/instructions text — and the criterion must be GROUNDED on the
 * very evidence the checkpoint was completed by. That is what makes "a name field cannot prove reaching
 * the in-world character" and "a conversation option cannot prove receiving a reply" structural.
 */
export function mapCheckpointEvidence(
  cp: GoalCheckpointV1,
  missions: MissionCoverageView[],
  isOutcome: boolean,
):
  | { ok: true; mapping: CheckpointEvidenceMapping }
  | { ok: false; code: JourneyRejectionCode } {
  let textualHit = false;
  for (const m of missions) {
    for (let i = 0; i < m.criteria.length; i++) {
      const g = m.grounding.find((x) => x.criterionIndex === i);
      const evidenceText = g
        ? (m.evidenceRequirements[g.evidenceIndex] ?? "")
        : "";
      // the criterion + the evidence that proves it — nothing else may satisfy the requirement.
      const pair = `${m.criteria[i]} \n ${evidenceText}`;
      if (!expressesCheckpoint(pair, cp)) continue;
      textualHit = true;
      if (!g) continue; // says the right thing but proves nothing
      // it must be grounded on THIS checkpoint's observed evidence (same facts/transition), so a criterion
      // about an earlier state can never stand in for a later requirement.
      const factHit = g.factIds.some((f) => cp.evidence.factIds.includes(f));
      const transHit = g.transitionIds.some((t) =>
        cp.evidence.transitionIds.includes(t),
      );
      if (!factHit && !transHit) continue;
      return {
        ok: true,
        mapping: {
          checkpointId: cp.checkpointId,
          missionKey: m.missionKey,
          criterionIndex: i,
          evidenceIndex: g.evidenceIndex,
          factIds: g.factIds.filter((f) => cp.evidence.factIds.includes(f)),
          transitionIds: g.transitionIds.filter((t) =>
            cp.evidence.transitionIds.includes(t),
          ),
          evidenceMode: g.evidenceMode,
        },
      };
    }
  }
  if (isOutcome) {
    // the founder's asked-for RESULT must be tied to the state where the result was actually observed.
    return {
      ok: false,
      code: textualHit
        ? "goal_outcome_evidence_insufficient"
        : "goal_outcome_uncovered",
    };
  }
  return {
    ok: false,
    code: textualHit
      ? "goal_checkpoint_evidence_unmapped"
      : "goal_checkpoint_uncovered",
  };
}

/** Does this criterion+evidence pair express the checkpoint's requirement? (token coverage + entity) */
function expressesCheckpoint(pair: string, cp: GoalCheckpointV1): boolean {
  const entityOk = !cp.targetEntity || containsAny(pair, cp.targetEntity);
  if (!entityOk) return false;
  return containsAll(pair, cp.requirement) || coversByKeywords(pair, cp);
}

/**
 * The GATE: a grounded plan may only be selected when EVERY founder-required checkpoint is (a) observed in
 * the browser with real evidence and (b) mapped to a mission CRITERION + EVIDENCE pair grounded on that
 * same evidence. Correct wording in a title or objective can never compensate for a missing criterion.
 * A plan made only of prerequisites is rejected. Pure + deterministic.
 */
export function checkJourneyCoverage(
  journey: GoalJourneyV1,
  missions: MissionCoverageView[],
): JourneyCoverageResult {
  const rejections: JourneyCoverageResult["rejections"] = [];
  const mappings: CheckpointEvidenceMapping[] = [];
  const required = requiredCheckpoints(journey);
  const outcomes = outcomeCheckpoints(journey);
  let covered = 0;

  for (const cp of required) {
    const isOutcome = outcomes.some((o) => o.checkpointId === cp.checkpointId);
    if (cp.status === "blocked") {
      rejections.push({
        code: "goal_checkpoint_wrong_context",
        checkpointId: cp.checkpointId,
        requirement: cp.requirement,
      });
      continue;
    }
    if (
      cp.status !== "observed" ||
      (cp.evidence.factIds.length === 0 &&
        cp.evidence.transitionIds.length === 0)
    ) {
      rejections.push({
        code: "goal_checkpoint_unobserved",
        checkpointId: cp.checkpointId,
        requirement: cp.requirement,
      });
      continue;
    }
    const m = mapCheckpointEvidence(cp, missions, isOutcome);
    if (!m.ok) {
      rejections.push({
        code: m.code,
        checkpointId: cp.checkpointId,
        requirement: cp.requirement,
      });
      continue;
    }
    mappings.push(m.mapping);
    covered++;
  }

  // a plan that covers ONLY prerequisites (nothing at/after the founder's outcome) is never the answer.
  const outcomeMapped = outcomes.every((o) =>
    mappings.some((x) => x.checkpointId === o.checkpointId),
  );
  if (
    !outcomeMapped &&
    missions.length > 0 &&
    !rejections.some(
      (r) =>
        r.code === "goal_outcome_uncovered" ||
        r.code === "goal_outcome_evidence_insufficient",
    )
  ) {
    const o = outcomes[0];
    if (o)
      rejections.push({
        code: "prerequisite_only_plan",
        checkpointId: o.checkpointId,
        requirement: o.requirement,
      });
  }

  return {
    ok: rejections.length === 0,
    rejections: rejections.slice(0, 12),
    mappings,
    observedCount: required.filter((c) => c.status === "observed").length,
    requiredCount: required.length,
    coveredCount: covered,
  };
}

/* ───────────────────── bounded projections (prompt + telemetry) ───────────── */

/** The bounded journey view handed to the architect/critic — requirements + status, never raw evidence. */
export function journeyForPrompt(journey: GoalJourneyV1): {
  goal: string;
  note: string;
  checkpoints: Array<{
    id: string;
    kind: CheckpointKind;
    requirement: string;
    targetEntity: string;
    requiredContext: string;
    requiredPhase: string;
    status: CheckpointStatus;
    sourcePhrase: string;
    evidenceFactIds: string[];
  }>;
} {
  return {
    goal: journey.goal,
    note:
      "The founder's request decomposed into ordered checkpoints. Your plan MUST cover EVERY observed checkpoint — " +
      "especially the final outcome. For each one, write a criterion that asserts exactly that requirement, CITE that " +
      "checkpoint's own evidenceFactIds in that criterion's factRefs, and give it an evidenceRequirement that proves " +
      'it. Use criterionKind "state" or "content_claim" for these (only use "action_outcome" when a transition ' +
      "id from the citable `transitions` list proves it). A criterion about an earlier step, or one citing another " +
      "state's evidence, does NOT count — a mission about a prerequisite is not an answer to the founder's request.",
    checkpoints: journey.checkpoints.map((c) => ({
      id: c.checkpointId,
      kind: c.kind,
      requirement: c.requirement,
      targetEntity: c.targetEntity,
      requiredContext: c.requiredContext,
      requiredPhase: c.requiredPhase ?? "",
      status: c.status,
      sourcePhrase: c.sourcePhrase,
      evidenceFactIds: c.evidence.factIds.slice(0, 6),
    })),
  };
}

/** Leak-safe telemetry projection (counts + ids + statuses only — never observed product text). */
export function journeyTelemetry(journey: GoalJourneyV1 | null | undefined) {
  if (!journey) return { journeyPresent: false as const };
  const byStatus = { unmet: 0, observed: 0, blocked: 0 };
  for (const c of journey.checkpoints) byStatus[c.status]++;
  return {
    journeyPresent: true as const,
    journeyDigest: journey.digest,
    checkpointCount: journey.checkpoints.length,
    checkpointsObserved: byStatus.observed,
    checkpointsUnmet: byStatus.unmet,
    checkpointsBlocked: byStatus.blocked,
    journeyModel: journey.model,
  };
}
