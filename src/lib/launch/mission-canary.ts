import { createHash } from "node:crypto";
import type { MissionGroundingMode, GroundedCandidatePlan } from "./mission-grounding-shadow";

/**
 * Phase 5 — FOUNDER CANARY selection authority + strict grounded-plan gating.
 *
 * This module decides whether a grounded V2 plan may REPLACE the legacy plan for one launch. It is deliberately
 * PURE (no network, no DB, no env writes) and has exactly one job: given the grounding mode, a SERVER-VERIFIED
 * founder identity, and the compiled grounded plan, return one of {disabled, unauthorized, blocked, selected}.
 *
 * NON-NEGOTIABLE: the canary authority is NEVER derived from founder text, Telegram messages, model output,
 * product content, or campaign metadata. The only inputs that grant authority are (a) the process-level mode
 * env, (b) a server-provided identity whose `source` proves it came from the authenticated server path, and
 * (c) the operator-controlled server allowlist. A blocked/unauthorized result NEVER silently launches legacy —
 * the caller preserves legacy for comparison and requires explicit manual handling.
 */

/** A founder identity that ONLY the authenticated server path may construct. `source: "server_session"` is the
 *  proof-of-provenance tag — no code that parses founder/model/product text is permitted to mint one. */
export interface CanaryIdentity {
  /** the SIWE-verified founder wallet the job was created under (lowercased by the resolver). */
  wallet: string;
  /** OPERATOR authorization (the operator allowlisted this wallet) — NOT founder consent. This is one
   *  operator-controlled signal; the actual founder decision is the separate SIWE approval of the revision.
   *  Named honestly so nothing downstream mistakes allowlisting for the founder having opted in. */
  operatorAuthorized: boolean;
  /** provenance tag — must be exactly "server_session" for the identity to carry any authority. */
  source: "server_session";
}

/** A syntactically valid, non-anonymous EVM wallet: 0x + 40 hex. Rejects "anonymous", empty, malformed, and
 *  anything that could have originated from request/model/product text (those never match this shape). */
export function isValidFounderWallet(w: string | null | undefined): boolean {
  if (!w || typeof w !== "string") return false;
  const t = w.trim().toLowerCase();
  if (t === "anonymous") return false;
  return /^0x[0-9a-f]{40}$/.test(t);
}

/** The operator-controlled server allowlist of founder wallets eligible for the canary (comma/space separated,
 *  case-insensitive). Empty/unset ⇒ nobody is eligible (fails closed). Read ONLY from process env — never from
 *  any request-supplied value. */
export function canaryAllowlist(): ReadonlySet<string> {
  const raw = process.env.MISSION_CANARY_ALLOWLIST?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(/[,\s]+/).map((w) => w.trim().toLowerCase()).filter(Boolean));
}

export type CanaryAuthority =
  | { allowed: true; wallet: string }
  | { allowed: false; reason: string };

/**
 * The authority gate. ALL of these must hold: mode is canary; a server-session identity is present; it carries
 * an explicit opt-in; and its wallet is on the server allowlist. Any failure returns allowed:false with a
 * bounded reason. This function reads NOTHING from untrusted content.
 */
export function resolveCanaryAuthority(mode: MissionGroundingMode, identity: CanaryIdentity | null): CanaryAuthority {
  if (mode !== "canary") return { allowed: false, reason: "mode_not_canary" };
  if (!identity || identity.source !== "server_session") return { allowed: false, reason: "no_server_identity" };
  if (!isValidFounderWallet(identity.wallet)) return { allowed: false, reason: "invalid_wallet" };
  const wallet = identity.wallet.trim().toLowerCase();
  if (!identity.operatorAuthorized) return { allowed: false, reason: "not_operator_authorized" };
  if (!canaryAllowlist().has(wallet)) return { allowed: false, reason: "not_allowlisted" };
  return { allowed: true, wallet };
}

/** Every strict signal that must be true for a grounded plan to be selectable (mirrors GroundedPlanSignals). */
const REQUIRED_SIGNAL_KEYS = [
  "architectStrictValid",
  "compilerProducedMissions",
  "everyCriterionCriticSupported",
  "allDecisiveGrounded",
  "noInferredOnlyDecisive",
  "safeTransitionsEstablished",
  "canonicalGatePassed",
  "allocationExactEqual",
  "provenancePresent",
] as const;

/** The first strict condition the grounded plan fails (bounded code), or null when every condition holds and
 *  at least one mission is present. Recomputed here rather than trusting `plan.strictSelectable` alone. */
export function firstUnmetStrictCondition(plan: GroundedCandidatePlan | null | undefined): string | null {
  if (!plan) return "no_grounded_plan";
  if (plan.missions.length === 0) return "no_missions";
  for (const k of REQUIRED_SIGNAL_KEYS) if (!plan.signals[k]) return `signal:${k}`;
  if (plan.suppliedBudgetBase !== plan.allocatedBudgetBase) return "budget_not_exact_equal";
  if (!plan.architectModel || !plan.architectProvider || !plan.criticModel || !plan.criticProvider) return "provenance_missing";
  return null;
}

/** A deterministic digest over the grounded plan's load-bearing content — mission keys/criteria/weights/caps +
 *  budget + observation-set + model provenance. Stable under reordering-insensitive canonicalization so the same
 *  plan always yields the same digest (used to bind an approval token to an exact plan). */
export function deterministicGroundedPlanDigest(plan: GroundedCandidatePlan): string {
  const canonical = {
    v: "grounded-canary-plan-v1",
    observationSetDigest: plan.observationSetDigest,
    suppliedBudgetBase: plan.suppliedBudgetBase,
    allocatedBudgetBase: plan.allocatedBudgetBase,
    architectModel: plan.architectModel,
    architectProvider: plan.architectProvider,
    criticModel: plan.criticModel,
    criticProvider: plan.criticProvider,
    missions: [...plan.missions]
      .sort((a, b) => a.missionKey.localeCompare(b.missionKey))
      .map((m) => ({
        missionKey: m.missionKey,
        objective: m.objective.normalize("NFC").trim(),
        rewardWeight: m.rewardWeight,
        maxCompletions: m.maxCompletions,
        priority: m.priority,
        effortMinutes: m.effortMinutes,
        criteria: m.criteria.map((c) => c.normalize("NFC").trim()),
      })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** A deterministic COMMITMENT digest over an EXACT (plan digest, budget, revision). It is NOT an authorization
 *  token and grants nothing: the ONLY authorization is the founder's SIWE approval of the revision through the
 *  approve endpoint, which independently recomputes hashes + budget. This commitment is provenance only — it
 *  lets an approval record pin exactly which grounded plan+budget+revision was selected, so a later reader can
 *  detect a changed plan. It changes if any bound field changes. */
export interface CanaryPlanCommitment {
  commitment: string;
  planDigest: string;
  budgetText: string;
  budgetBase: string;
  revision: number;
}
export function canaryPlanCommitment(input: { planDigest: string; budgetText: string; budgetBase: string; revision: number }): CanaryPlanCommitment {
  const commitment = createHash("sha256")
    .update(JSON.stringify({ v: "canary-plan-commitment-v1", planDigest: input.planDigest, budgetText: input.budgetText, budgetBase: input.budgetBase, revision: input.revision }))
    .digest("hex");
  return { commitment, planDigest: input.planDigest, budgetText: input.budgetText, budgetBase: input.budgetBase, revision: input.revision };
}

export type CanaryDecision =
  /** mode is off|shadow (or no plan present in an off run) → legacy proceeds exactly as before. */
  | { status: "disabled"; reason: string }
  /** canary armed, but THIS founder isn't authorized → legacy proceeds normally (canary simply doesn't apply). */
  | { status: "unauthorized"; reason: string }
  /** authorized founder, but the grounded plan failed a strict condition → DO NOT launch legacy silently;
   *  preserve legacy for comparison and require explicit manual handling. */
  | { status: "blocked"; reason: string }
  /** all conditions met → the grounded plan is selected; the caller compiles it and binds the approval. */
  | { status: "selected"; wallet: string; plan: GroundedCandidatePlan; groundedDigest: string };

/**
 * The single decision the pipeline calls. It composes the authority gate with the strict plan gate:
 *  - mode ≠ canary            → disabled (legacy proceeds)
 *  - unauthorized founder     → unauthorized (legacy proceeds)
 *  - authorized + plan good   → selected
 *  - authorized + plan bad    → blocked (NEVER silently launch legacy)
 */
export function evaluateCanarySelection(args: {
  mode: MissionGroundingMode;
  identity: CanaryIdentity | null;
  plan: GroundedCandidatePlan | null | undefined;
}): CanaryDecision {
  const auth = resolveCanaryAuthority(args.mode, args.identity);
  if (!auth.allowed) return args.mode === "canary" ? { status: "unauthorized", reason: auth.reason } : { status: "disabled", reason: auth.reason };
  const unmet = firstUnmetStrictCondition(args.plan);
  if (unmet) return { status: "blocked", reason: unmet };
  const plan = args.plan!;
  return { status: "selected", wallet: auth.wallet, plan, groundedDigest: deterministicGroundedPlanDigest(plan) };
}
