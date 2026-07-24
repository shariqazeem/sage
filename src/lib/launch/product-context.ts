import { createHash } from "node:crypto";

/**
 * Product-context identity — WHERE in a product something was observed, and WHICH occurrence of a thing
 * it was. Without this, "go to the [character]" is satisfiable by the character's name appearing on an
 * onboarding screen; with it, that occurrence is a DIFFERENT entity instance in a DIFFERENT phase, and the
 * founder's requirement stays unmet until the real one is reached in the product's main experience.
 *
 * Everything here is deterministic and product-agnostic: phases come from the shape of the observed run
 * (an entry load, a linear forward ladder, the point where the ladder stops, a target interaction), and
 * entity instances are minted per (label, phase, state). No product names, no coordinates.
 */

export const PRODUCT_CONTEXT_VERSION = "product-context-v1" as const;

/** The phase of a product's lifecycle a state belongs to (ordered). */
export type ExperiencePhase =
  | "entry"
  | "onboarding"
  | "main_experience"
  | "target_interaction";

const PHASE_ORDER: Record<ExperiencePhase, number> = {
  entry: 0,
  onboarding: 1,
  main_experience: 2,
  target_interaction: 3,
};

/** Is `a` at least as deep into the product as `b`? */
export function phaseAtLeast(a: ExperiencePhase, b: ExperiencePhase): boolean {
  return PHASE_ORDER[a] >= PHASE_ORDER[b];
}

/** One OCCURRENCE of a named thing, in one phase, in one state. The same label in another phase is a
 *  DIFFERENT instance with a different id — that distinction is the whole point. */
export interface EntityInstanceV1 {
  /** Sage-minted, deterministic: sha(label|phase|stateId). Never model-authored. */
  entityId: string;
  label: string;
  /** coarse, derived from how it was observed — never a product-specific taxonomy. */
  kind: "control" | "heading" | "field" | "item";
  phase: ExperiencePhase;
  stateId: string;
  stateIndex: number;
  /** what can be done with it here, e.g. ["click"], ["type"] — empty when it is only text. */
  affordances: string[];
}

export interface PhaseTransitionV1 {
  from: ExperiencePhase;
  to: ExperiencePhase;
  /** the state index at which the product entered `to`. */
  atStateIndex: number;
  /** what Sage did to cross it (its trigger), bounded. */
  trigger: string;
}

export interface ProductContextV1 {
  version: typeof PRODUCT_CONTEXT_VERSION;
  /** phase per observed state index. */
  statePhases: ExperiencePhase[];
  entities: EntityInstanceV1[];
  phaseTransitions: PhaseTransitionV1[];
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const lower = (s: string) => norm(s).toLowerCase();

/** The state shape this module needs (a subset of FieldTestState — no Playwright dependency). */
export interface ContextState {
  trigger: string;
  visibleTextExcerpt: string;
  notableElements?: { tag: string; text: string; role: string }[];
  actionKind?: string;
  actedLabel?: string;
  /** authoritative phase, minted by the field test while it ran (preferred over derivation). */
  experiencePhase?: ExperiencePhase;
}

/** Forward/onboarding intents — a click on one of these is a step through a LINEAR ladder, not arrival. */
const LADDER =
  /\b(start|begin|get started|continue|next|proceed|enter|come in|step inside|skip|dive in|let'?s go|got it|done|finish|close|dismiss|play|join|onward)\b/i;

/**
 * Derive the phase of each observed state. Deterministic and general:
 *   · state 0 is `entry`;
 *   · while Sage is clicking LINEAR forward controls (or filling the fields they gate), it is `onboarding`;
 *   · the first state reached by an action that is NOT a forward-ladder step is the `main_experience`
 *     (the ladder has ended — the product handed over control);
 *   · once a conversation/target interaction begins (an input is supplied to a target), it is
 *     `target_interaction`, which stays for the rest of the run.
 * A state that recorded its own `experiencePhase` (minted live by the field test) always wins.
 */
export function derivePhases(states: ContextState[]): ExperiencePhase[] {
  const out: ExperiencePhase[] = [];
  let current: ExperiencePhase = "entry";
  states.forEach((s, i) => {
    if (s.experiencePhase) {
      current = s.experiencePhase;
      out.push(current);
      return;
    }
    if (i === 0) {
      current = "entry";
      out.push(current);
      return;
    }
    if (current === "target_interaction") {
      out.push(current);
      return;
    }
    // supplying an input to a target (a message) begins the target interaction.
    if (
      s.actionKind === "type" ||
      s.actionKind === "submit" ||
      s.actionKind === "observe_response"
    ) {
      // a fill during a linear ladder (a name field) is still onboarding — but once the main experience
      // is reached, supplying input IS the target interaction.
      current =
        current === "main_experience"
          ? "target_interaction"
          : current === "entry"
            ? "onboarding"
            : current;
      out.push(current);
      return;
    }
    // A state belongs to ONBOARDING while the product is still ASKING the user to move forward — i.e. this
    // state itself presents a forward-ladder affordance ("continue", "come in", "skip"). The moment a state
    // no longer offers one, the linear part is over and the main experience has begun. (The click that
    // crosses the last ladder step therefore lands in the main experience, which is what a user experiences.)
    const offersLadder =
      (s.notableElements ?? []).some((e) => LADDER.test(e.text ?? "")) ||
      LADDER.test(s.visibleTextExcerpt ?? "");
    if (offersLadder && !phaseAtLeast(current, "main_experience")) {
      current = "onboarding";
      out.push(current);
      return;
    }
    current = phaseAtLeast(current, "main_experience")
      ? current
      : "main_experience";
    out.push(current);
  });
  return out;
}

const kindOf = (tag: string, role: string): EntityInstanceV1["kind"] => {
  const t = lower(tag);
  const r = lower(role);
  if (t === "input" || t === "textarea" || t === "select") return "field";
  if (t === "button" || t === "a" || r === "button" || r === "link")
    return "control";
  if (/^h[1-6]$/.test(t)) return "heading";
  return "item";
};
const affordancesOf = (kind: EntityInstanceV1["kind"]): string[] =>
  kind === "field" ? ["type"] : kind === "control" ? ["click"] : [];

/**
 * Build the product context from the observed states: a phase per state, every entity OCCURRENCE tagged
 * with its phase + state, and the phase transitions. Pure + deterministic.
 */
export function buildProductContext(
  states: ContextState[],
  stateIds: readonly string[],
): ProductContextV1 {
  const statePhases = derivePhases(states);
  const entities: EntityInstanceV1[] = [];
  const seen = new Set<string>();
  states.forEach((s, i) => {
    const phase = statePhases[i] ?? "entry";
    const stateId = stateIds[i] ?? "";
    const add = (label: string, kind: EntityInstanceV1["kind"]) => {
      const l = norm(label).slice(0, 80);
      if (!l) return;
      const entityId = sha(
        `${PRODUCT_CONTEXT_VERSION}|${lower(l)}|${phase}|${stateId}`,
      ).slice(0, 16);
      if (seen.has(entityId)) return;
      seen.add(entityId);
      entities.push({
        entityId,
        label: l,
        kind,
        phase,
        stateId,
        stateIndex: i,
        affordances: affordancesOf(kind),
      });
    };
    for (const e of s.notableElements ?? []) add(e.text, kindOf(e.tag, e.role));
    // the thing Sage acted on is an entity occurrence too (it may not be in notableElements).
    if (s.actedLabel) add(s.actedLabel, "control");
  });

  const phaseTransitions: PhaseTransitionV1[] = [];
  for (let i = 1; i < statePhases.length; i++) {
    if (statePhases[i] !== statePhases[i - 1]) {
      phaseTransitions.push({
        from: statePhases[i - 1],
        to: statePhases[i],
        atStateIndex: i,
        trigger: norm(states[i]?.trigger ?? "").slice(0, 120),
      });
    }
  }
  return {
    version: PRODUCT_CONTEXT_VERSION,
    statePhases,
    entities,
    phaseTransitions,
  };
}

/** Every occurrence whose label matches this entity name (word-level, case-insensitive). */
export function instancesOf(
  context: ProductContextV1,
  entity: string,
): EntityInstanceV1[] {
  const words = lower(entity)
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return [];
  return context.entities.filter((e) => {
    const l = lower(e.label);
    return words.some((w) => l.includes(w));
  });
}

/** Did the product ever reach this phase? */
export function reachedPhase(
  context: ProductContextV1,
  phase: ExperiencePhase,
): boolean {
  return context.statePhases.some((p) => phaseAtLeast(p, phase));
}

/** A bounded, leak-safe projection for a prompt/telemetry (labels + phases only, no page text). */
export function contextForPrompt(context: ProductContextV1): {
  phasesReached: ExperiencePhase[];
  phaseTransitions: Array<{ from: string; to: string; at: number }>;
  entities: Array<{
    entityId: string;
    label: string;
    kind: string;
    phase: string;
    affordances: string[];
  }>;
} {
  return {
    phasesReached: [...new Set(context.statePhases)],
    phaseTransitions: context.phaseTransitions.map((t) => ({
      from: t.from,
      to: t.to,
      at: t.atStateIndex,
    })),
    entities: context.entities.slice(0, 40).map((e) => ({
      entityId: e.entityId,
      label: e.label,
      kind: e.kind,
      phase: e.phase,
      affordances: e.affordances,
    })),
  };
}
