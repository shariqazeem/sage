import { describe, it, expect } from "vitest";
import {
  compileGoalMission,
  buildCompilerSupportProof,
  verifyCompilerSupportProof,
  applyProseRefinement,
  productContextDigest,
  missionContentDigest,
  GOAL_MISSION_COMPILER_VERSION,
  type CompilerSupportProofV1,
  type CompileGoalInput,
} from "./goal-mission-compiler";
import {
  buildJourneySteps,
  type GoalJourneyV1,
  type JourneyStep,
} from "./goal-journey";
import type { ProductContextV1 } from "./product-context";
import type { ObservedFactV1, ActionTransitionV1 } from "./observed-facts";
import type { CandidateMission } from "./schemas";
import fixture from "./__fixtures__/yara-production-run.json";

/**
 * COMPILER SUPPORT PROOF — a compiled criterion may stand without a model critic's verdict ONLY because
 * Sage can RECOMPUTE the whole compilation from immutable inputs and re-verify the final mission against
 * it. Nothing is taken on trust: no provenance flag, no model field, no persisted boolean. Zero model calls.
 */

const journey = fixture.goalJourney as unknown as GoalJourneyV1;
const context = fixture.productContext as unknown as ProductContextV1;
const facts = fixture.observations.facts as unknown as ObservedFactV1[];
const transitions = fixture.observations
  .transitions as unknown as ActionTransitionV1[];
const OBS_DIGEST = fixture.observations.digest as unknown as string;

const steps: JourneyStep[] = buildJourneySteps(
  fixture.states as never,
  facts,
  transitions,
  (fixture.states as unknown[]).map((_, i) => {
    const e = context.entities.find((x) => x.stateIndex === i);
    return e?.stateId ?? "";
  }),
).map((s, i) => ({ ...s, phase: context.statePhases[i] }));

const input = (): CompileGoalInput => ({
  journey,
  context,
  steps,
  facts,
  transitions,
  productUrl: "https://yara.garden/",
  totalBudgetBase: BigInt(fixture.totalBudgetBase),
});

/** Compile + issue a proof exactly as the shadow does (prose polish included). */
function compiledWithProof(prose?: Record<string, unknown>) {
  const r = compileGoalMission(input());
  if (!r.ok) throw new Error(`compile failed: ${r.reason}`);
  const mission = prose
    ? applyProseRefinement(r.compiled.mission, prose)
    : r.compiled.mission;
  const proof = buildCompilerSupportProof({
    mission,
    mappings: r.compiled.mappings,
    criteria: r.compiled.criteria,
    resolvedEntity: r.compiled.resolvedEntity,
    journey,
    context,
    observationSetDigest: OBS_DIGEST,
  });
  return { mission, proof, compiled: r.compiled };
}

const verify = (
  mission: CandidateMission,
  proof: CompilerSupportProofV1 | null,
  over: Partial<CompileGoalInput> = {},
  obs = OBS_DIGEST,
) =>
  verifyCompilerSupportProof({
    mission,
    proof,
    input: { ...input(), ...over },
    observationSetDigest: obs,
  });

describe("CompilerSupportProofV1 — recomputed, never trusted", () => {
  it("#1 a valid compiled mission passes (and prose polish does not break it)", () => {
    const plain = compiledWithProof();
    expect(verify(plain.mission, plain.proof).ok).toBe(true);

    const polished = compiledWithProof({
      title: "Meet the character and get a reply",
      objective: "Walk in, find her, say hello and note what she says back.",
      instructions:
        "Open the site, step inside, find her, send a message, quote the reply.",
      whyItMatters:
        "The founder wants to know the conversation works for a newcomer.",
    });
    expect(polished.mission.title).toBe("Meet the character and get a reply");
    expect(verify(polished.mission, polished.proof).ok).toBe(true); // proof issued over the FINAL mission
  });

  it("#2 a forged 'compiler-authored' flag proves nothing — only a proof is accepted", () => {
    const { mission } = compiledWithProof();
    // a mission decorated with any provenance-looking field, but NO proof
    const forged = {
      ...mission,
      compilerAuthored: true,
      trusted: true,
    } as unknown as CandidateMission;
    const v = verify(forged, null);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("compiler_support_proof_invalid");
      expect(v.mismatch).toBe("absent");
    }
  });

  it("#3 model output cannot set the proof — a hand-made/tampered proof fails its own digest", () => {
    const { mission, proof } = compiledWithProof();
    // a model-supplied object shaped like a proof
    const fabricated = {
      version: "compiler-support-proof-v1",
      compilerVersion: GOAL_MISSION_COMPILER_VERSION,
      journeyDigest: journey.digest,
      observationSetDigest: OBS_DIGEST,
      productContextDigest: productContextDigest(context),
      entityId: "whatever",
      mappingsDigest: "deadbeef",
      evidenceDigest: "deadbeef",
      missionDigest: missionContentDigest(mission),
      proofDigest: "deadbeef",
    } as unknown as CompilerSupportProofV1;
    const v = verify(mission, fabricated);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("proof_digest");

    // and flipping a single field of a REAL proof invalidates it too
    const tampered = { ...proof, entityId: "someone-else" };
    const v2 = verify(mission, tampered);
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.mismatch).toBe("proof_digest");
  });

  it("#4 a changed FACT ID fails", () => {
    const { mission, proof } = compiledWithProof();
    const g = mission.groundingV1!.criteria.map((c, i) =>
      i === 0
        ? {
            ...c,
            sourceFactIds: [
              ...c.sourceFactIds.slice(1),
              facts[facts.length - 1].id,
            ],
          }
        : c,
    );
    const edited: CandidateMission = {
      ...mission,
      groundingV1: { ...mission.groundingV1!, criteria: g },
    };
    const v = verify(edited, proof);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("mission_digest"); // the mission no longer matches what was proven
  });

  it("#5 a changed ENTITY ID fails", () => {
    const { mission, proof } = compiledWithProof();
    // the proof commits to the behaviourally-resolved occurrence; swapping it out invalidates the proof.
    const wrongEntity = { ...proof, entityId: context.entities[0].entityId };
    const v = verify(mission, wrongEntity);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("proof_digest");

    // and if the CONTEXT itself changes (different occurrences), verification fails on the context digest
    const otherContext: ProductContextV1 = {
      ...context,
      entities: context.entities.slice(1),
    };
    const v2 = verify(mission, proof, { context: otherContext });
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.mismatch).toBe("product_context_digest");
  });

  it("#6 a changed CHECKPOINT MAPPING fails", () => {
    const { mission, proof } = compiledWithProof();
    // re-point criterion 1's evidence index (the checkpoint→evidence mapping the proof committed to)
    const g = mission.groundingV1!.criteria.map((c) =>
      c.criterionIndex === 1 ? { ...c, evidenceIndex: 0 } : c,
    );
    const edited: CandidateMission = {
      ...mission,
      groundingV1: { ...mission.groundingV1!, criteria: g },
    };
    const v = verify(edited, proof);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("mission_digest");

    // and a journey whose checkpoints differ (different mapping) fails on the journey digest
    const otherJourney: GoalJourneyV1 = {
      ...journey,
      digest: `${journey.digest}x`,
    };
    const v2 = verify(mission, proof, { journey: otherJourney });
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.mismatch).toBe("journey_digest");
  });

  it("#7 changed mission WORDING / content digest fails", () => {
    const { mission, proof } = compiledWithProof();
    for (const edited of [
      { ...mission, title: "Something else entirely" },
      {
        ...mission,
        criteria: [...mission.criteria.slice(0, 1), "Just click around a bit"],
      },
      {
        ...mission,
        evidenceRequirements: [
          ...mission.evidenceRequirements.slice(0, 1),
          "Say it went fine",
        ],
      },
      { ...mission, anchors: ["not observed"] },
    ]) {
      const v = verify(edited as CandidateMission, proof);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mismatch).toBe("mission_digest");
    }
  });

  it("#8 a STALE observationSetDigest fails", () => {
    const { mission, proof } = compiledWithProof();
    const v = verify(mission, proof, {}, "0000000000000000stale");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("observation_set_digest");
  });

  it("a proof from an older compiler version never validates", () => {
    const { mission, proof } = compiledWithProof();
    const old = {
      ...proof,
      compilerVersion: "goal-mission-compiler-v0",
    } as unknown as CompilerSupportProofV1;
    const v = verify(mission, old);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("compiler_version");
  });

  it("verification RECOMPUTES: a mission that no criterion of the compiler would produce fails", () => {
    const { proof } = compiledWithProof();
    // a structurally plausible mission with the SAME key but different criteria — never compiled by Sage.
    const impostor = compiledWithProof().mission;
    const swapped: CandidateMission = {
      ...impostor,
      criteria: ["The tester says the product is nice"],
      evidenceRequirements: ["A sentence about the vibe"],
      groundingV1: {
        version: "mission-grounding-v1",
        criteria: [
          {
            criterionIndex: 0,
            evidenceIndex: 0,
            sourceFactIds: [facts[0].id],
            verificationMode: "observation",
            criterionKind: "state",
          },
        ],
      },
    };
    const v = verify(swapped, proof);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("mission_digest");
  });
});

/* ── #9 model-authored missions still require the existing critic verdict ── */

describe("#9 the bypass is scoped to PROVEN compiler missions only", () => {
  it("a model-authored mission carries no proof, so it can never be compiler-supported", () => {
    const modelAuthored: CandidateMission = {
      missionKey: "model-written",
      title: "Try the app",
      objective: "See how it feels",
      instructions: "Poke around",
      targetSurface: "https://yara.garden/",
      criteria: ["The tester reports their impression"],
      evidenceRequirements: ["A short write-up"],
      whyItMatters: "vibes",
      sources: [],
      priority: "medium",
      riskCategory: "critical_journey",
      effortMinutes: 5,
      conditions: [],
      rewardWeight: 5,
      maxCompletions: 1,
      verificationMethod: "observation",
      confidence: 0.5,
      assumptions: [],
      disallowed: [],
      groundingV1: {
        version: "mission-grounding-v1",
        criteria: [
          {
            criterionIndex: 0,
            evidenceIndex: 0,
            sourceFactIds: [facts[0].id],
            verificationMode: "observation",
          },
        ],
      },
    };
    // no proof exists for it → not compiler-supported → the critic verdict remains its only route.
    expect(verify(modelAuthored, null).ok).toBe(false);
    // even paired with a VALID proof issued for the compiled mission, it fails (the proof binds that mission)
    const { proof } = compiledWithProof();
    const v = verify(modelAuthored, proof);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mismatch).toBe("mission_digest");
  });
});
