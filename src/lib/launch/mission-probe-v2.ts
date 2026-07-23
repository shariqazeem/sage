import { createHash } from "node:crypto";
import { z } from "zod";
import { compileMissionProbe, validateProbeIntegrity, type MissionProbeV1, type ProbeRejectionCode } from "./mission-probe";
import type { ObservationSetV1 } from "./observed-facts";
import type { CandidateMission } from "./schemas";
import type { ValidationScope } from "./validate-mission";

/**
 * Phase 1 — VerificationPolicyV2. A COMPLETE, self-verifying policy: exactly one `actionCriteria` entry for
 * every action_outcome criterion in the selected grounded plan, and exactly one valid probe per entry. A
 * rejected/missing probe leaves an entry with an EMPTY probeDigest, which makes the policy INCOMPLETE — and an
 * incomplete action policy can never be marked autonomous-replay eligible. V1 is preserved unchanged for history.
 */

export const VERIFICATION_POLICY_V2_VERSION = "verification-policy-v2" as const;

export interface ActionCriterionRef {
  missionKey: string;
  criterionIndex: number;
  /** the bound probe's digest, or "" when no valid probe compiled for this action criterion (→ incomplete). */
  probeDigest: string;
}

export interface VerificationPolicyV2 {
  version: typeof VERIFICATION_POLICY_V2_VERSION;
  missionPlanDigest: string;
  productMapDigest: string;
  observationSetDigest: string;
  actionCriteria: ActionCriterionRef[];
  probes: MissionProbeV1[];
  policyDigest: string;
}

/** Key-order-INDEPENDENT canonical serialization (recursively sorts object keys) so the digest is invariant to
 *  key order — a Zod-parsed policy (keys reordered to schema order) recomputes to the same digest. */
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Strict nested Zod — unknown fields fail at every level; every probe is fully validated. */
const ProbeSchema = z
  .object({
    version: z.literal("mission-probe-v1"),
    probeId: z.string().min(1),
    missionKey: z.string().min(1),
    criterionIndex: z.number().int().nonnegative(),
    kind: z.literal("action_replay"),
    observationSetDigest: z.string().min(1),
    sourceFactIds: z.array(z.string()),
    sourceTransitionId: z.string().min(1),
    startUrl: z.string().min(1),
    beforeStateDigest: z.string(),
    action: z.object({ verb: z.enum(["click", "press"]), role: z.string(), name: z.string().min(1), key: z.string().optional() }).strict(),
    expected: z.object({ afterUrl: z.string(), afterStateDigest: z.string(), addedTexts: z.array(z.string()), removedTexts: z.array(z.string()) }).strict(),
    safety: z.object({ classification: z.literal("safe"), networkMethods: z.array(z.enum(["GET", "HEAD"])), inspectionReplayReproduced: z.literal(true) }).strict(),
    probeDigest: z.string().min(1),
  })
  .strict();

export const VerificationPolicyV2Schema = z
  .object({
    version: z.literal(VERIFICATION_POLICY_V2_VERSION),
    missionPlanDigest: z.string().min(1),
    productMapDigest: z.string().min(1),
    observationSetDigest: z.string().min(1),
    actionCriteria: z.array(z.object({ missionKey: z.string().min(1), criterionIndex: z.number().int().nonnegative(), probeDigest: z.string() }).strict()),
    probes: z.array(ProbeSchema),
    policyDigest: z.string().min(1),
  })
  .strict();

/** Canonical digest over the load-bearing body (sorted set-like arrays) — reorder-invariant. */
export function verificationPolicyV2Digest(policy: Omit<VerificationPolicyV2, "policyDigest">): string {
  const actionCriteria = [...policy.actionCriteria].sort((a, b) => a.missionKey.localeCompare(b.missionKey) || a.criterionIndex - b.criterionIndex);
  const probes = [...policy.probes].sort((a, b) => a.missionKey.localeCompare(b.missionKey) || a.criterionIndex - b.criterionIndex);
  return sha(canon({ version: policy.version, missionPlanDigest: policy.missionPlanDigest, productMapDigest: policy.productMapDigest, observationSetDigest: policy.observationSetDigest, actionCriteria, probes }));
}

export type PolicyV2Completeness =
  | { complete: true }
  | { complete: false; reason: "missing_probe" | "duplicate_criterion" | "extra_probe" | "probe_criterion_mismatch" | "digest_mismatch" | "empty" | "probe_invalid" | "probe_obs_digest_mismatch" };

/**
 * Validate that a V2 policy is COMPLETE + self-consistent: no duplicate (missionKey, criterionIndex); every
 * actionCriteria entry has a non-empty probeDigest matching exactly one probe of the same key/index/digest; no
 * extra probe; the stored policyDigest recomputes. Any failure ⇒ NOT autonomous-replay eligible.
 */
export function validateVerificationPolicyV2Complete(policy: VerificationPolicyV2): PolicyV2Completeness {
  if (verificationPolicyV2Digest(policy) !== policy.policyDigest) return { complete: false, reason: "digest_mismatch" };
  const seen = new Set<string>();
  for (const ac of policy.actionCriteria) {
    const key = `${ac.missionKey}#${ac.criterionIndex}`;
    if (seen.has(key)) return { complete: false, reason: "duplicate_criterion" };
    seen.add(key);
  }
  if (policy.actionCriteria.length === 0) return { complete: false, reason: "empty" };
  // every action criterion must have a non-empty probeDigest matching exactly one probe of same key/index.
  for (const ac of policy.actionCriteria) {
    if (!ac.probeDigest) return { complete: false, reason: "missing_probe" };
    const matches = policy.probes.filter((p) => p.missionKey === ac.missionKey && p.criterionIndex === ac.criterionIndex && p.probeDigest === ac.probeDigest);
    if (matches.length !== 1) return { complete: false, reason: "probe_criterion_mismatch" };
  }
  // no extra probe: every probe must map to exactly one actionCriteria entry.
  for (const p of policy.probes) {
    const refs = policy.actionCriteria.filter((ac) => ac.missionKey === p.missionKey && ac.criterionIndex === p.criterionIndex && ac.probeDigest === p.probeDigest);
    if (refs.length !== 1) return { complete: false, reason: "extra_probe" };
  }
  // P5 — REVALIDATE each probe itself (not just the outer digest): recomputed probeDigest, source facts/
  // transition, state digests, URLs, outcome signal, safety evidence; and its obs-set digest must match the policy.
  for (const p of policy.probes) {
    if (p.observationSetDigest !== policy.observationSetDigest) return { complete: false, reason: "probe_obs_digest_mismatch" };
    if (!validateProbeIntegrity(p).ok) return { complete: false, reason: "probe_invalid" };
  }
  return { complete: true };
}

export interface CompilePolicyV2Input {
  missionPlanDigest: string;
  productMapDigest: string;
  set: ObservationSetV1;
  missions: CandidateMission[];
  replayReproduced: ReadonlySet<string>;
  scope: ValidationScope;
}

export interface CompilePolicyV2Result {
  policy: VerificationPolicyV2;
  complete: boolean;
  rejections: { missionKey: string; criterionIndex: number; code: ProbeRejectionCode }[];
}

/**
 * Compile a V2 policy: one actionCriteria entry per action_outcome criterion (probeDigest "" when its probe was
 * rejected → incomplete), one probe per compiled entry. `complete` gates autonomous-replay eligibility.
 */
export function compileVerificationPolicyV2(input: CompilePolicyV2Input): CompilePolicyV2Result {
  const actionCriteria: ActionCriterionRef[] = [];
  const probes: MissionProbeV1[] = [];
  const rejections: CompilePolicyV2Result["rejections"] = [];
  for (const mission of input.missions) {
    for (const gc of mission.groundingV1?.criteria ?? []) {
      if (gc.criterionKind !== "action_outcome") continue;
      const r = compileMissionProbe({ mission, criterionIndex: gc.criterionIndex, grounding: gc, set: input.set, replayReproduced: input.replayReproduced, scope: input.scope });
      if ("probe" in r) {
        actionCriteria.push({ missionKey: mission.missionKey, criterionIndex: gc.criterionIndex, probeDigest: r.probe.probeDigest });
        probes.push(r.probe);
      } else {
        actionCriteria.push({ missionKey: mission.missionKey, criterionIndex: gc.criterionIndex, probeDigest: "" }); // incomplete marker
        rejections.push({ missionKey: mission.missionKey, criterionIndex: gc.criterionIndex, code: r.rejected });
      }
    }
  }
  actionCriteria.sort((a, b) => a.missionKey.localeCompare(b.missionKey) || a.criterionIndex - b.criterionIndex);
  probes.sort((a, b) => a.missionKey.localeCompare(b.missionKey) || a.criterionIndex - b.criterionIndex);
  const body = { version: VERIFICATION_POLICY_V2_VERSION, missionPlanDigest: input.missionPlanDigest, productMapDigest: input.productMapDigest, observationSetDigest: input.set.digest, actionCriteria, probes };
  const policy: VerificationPolicyV2 = { ...body, policyDigest: verificationPolicyV2Digest(body) };
  return { policy, complete: validateVerificationPolicyV2Complete(policy).complete, rejections };
}

/** Parse an untrusted stored policy strictly, then require completeness. Returns the policy or a bounded reason. */
export function parseCompleteVerificationPolicyV2(raw: unknown): { ok: true; policy: VerificationPolicyV2 } | { ok: false; reason: string } {
  const parsed = VerificationPolicyV2Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema_invalid" };
  const completeness = validateVerificationPolicyV2Complete(parsed.data);
  if (!completeness.complete) return { ok: false, reason: `incomplete:${completeness.reason}` };
  return { ok: true, policy: parsed.data };
}
