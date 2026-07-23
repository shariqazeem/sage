import "server-only";

import { runInspectionProbe, type InspectionProbeV1, type ProbeClassification } from "@/lib/launch/inspection-replay";
import type { MissionProbeV1 } from "@/lib/launch/mission-probe";
import { loadVerifiedCampaignPolicy, probesForMission, policyMarksActionMission } from "./verification-policy";
import { REPLAY_RUNNER_VERSION, type ReplayJournalHandle } from "@/lib/db/payout-replay-journal";

/** P4 — the hard maximum age (seconds) of a reusable replay permit. Older than this ⇒ stale ⇒ re-run. ≤ 5 min. */
export const MAX_PERMIT_AGE_SEC = 300;
import type { Campaign } from "@/lib/db/schema";

/**
 * Phase 4 — PAYOUT ACTION REPLAY. Before settling an ACTION mission, Sage re-performs the exact deterministic
 * action in a FRESH guarded browser (reusing the existing runInspectionProbe + guarded egress — no new browser
 * subsystem) and compares the result to the bound MissionProbeV1's expected outcome.
 *
 * SUBTRACTIVE ONLY: a `reproduced` result does NOT create a payout, does NOT raise confidence, and does NOT
 * replace missing tester evidence — it merely ALLOWS an already-qualified decision to continue. Every other
 * result vetoes (canary) or is journaled (shadow). It can only turn a would-pay into a hold, never the reverse.
 */

export type PayoutReplayMode = "off" | "shadow" | "canary";
export function payoutActionReplayMode(): PayoutReplayMode {
  const v = process.env.PAYOUT_ACTION_REPLAY_MODE?.trim().toLowerCase();
  return v === "canary" ? "canary" : v === "shadow" ? "shadow" : "off"; // unset/off/unknown/enforce → off
}

/** The single bounded outcome of a payout action replay (never raw page content). */
export type PayoutReplayCode =
  | "reproduced"
  | "product_drift"
  | "locator_missing"
  | "locator_ambiguous"
  | "no_observable_change"
  | "wrong_after_state"
  | "unsafe_transition"
  | "timeout"
  | "egress_refused"
  | "policy_missing"
  | "policy_digest_mismatch"
  | "probe_not_applicable"
  | "internal_error";

/** Map a guarded-browser ProbeClassification (+ its machine reason) to the bounded payout outcome code. */
export function classifyReplay(classification: ProbeClassification, reason: string): PayoutReplayCode {
  switch (classification) {
    case "reproduced": return "reproduced";
    case "locator_ambiguous": return "locator_ambiguous";
    case "no_observable_change": return "no_observable_change";
    case "unsafe_rejected": return "unsafe_transition";
    case "probe_flake": return "timeout";
    case "infrastructure_failure": return /navigation failed|egress|blocked|refused/i.test(reason) ? "egress_refused" : "internal_error";
    case "product_drift":
      if (/not found/i.test(reason)) return "locator_missing";
      if (/not the expected/i.test(reason)) return "wrong_after_state";
      return "product_drift";
    default: return "internal_error";
  }
}

/** A MissionProbeV1 is executed by the EXISTING guarded-browser runner via this minimal InspectionProbeV1 view. */
function toInspectionProbe(p: MissionProbeV1): InspectionProbeV1 {
  return {
    version: "inspection-probe-v1" as InspectionProbeV1["version"],
    id: p.probeId,
    startUrl: p.startUrl,
    beforeStateDigest: p.beforeStateDigest,
    verb: p.action.verb,
    locator: { ...(p.action.role ? { role: p.action.role } : {}), accessibleName: p.action.name },
    ...(p.action.key ? { key: p.action.key } : {}),
    expectedAddedTexts: p.expected.addedTexts,
    expectedAfterUrl: p.expected.afterUrl,
    sourceTransitionId: p.sourceTransitionId,
    sourceFactIds: p.sourceFactIds,
    timeoutMs: 30_000,
  };
}

export type ReplayDecision = "skip" | "allow" | "hold";
export interface PayoutReplayResult {
  mode: PayoutReplayMode;
  /** skip = not applicable (off / non-action / no policy); allow = continue to settle; hold = VETO. */
  decision: ReplayDecision;
  code: PayoutReplayCode | null;
  /** per-probe bounded codes (ids + code only — never raw page text). */
  probeResults: { probeId: string; code: PayoutReplayCode }[];
  isActionMission: boolean;
}

/** TEST seam: override the browser runner + pass loopback/egress test deps. */
export interface PayoutReplayDeps {
  runProbe?: (probe: InspectionProbeV1) => Promise<{ classification: ProbeClassification; reason: string; probeId: string }>;
  allowLoopback?: ReadonlySet<string>;
  egressAllowedPorts?: ReadonlySet<number>;
  chromiumLauncher?: () => Promise<typeof import("playwright").chromium>;
  /** Phase 5 — idempotency journal keyed by (submissionId, policyDigest, probeDigest). Undefined ⇒ no caching. */
  journal?: ReplayJournalHandle;
  /** the submission being settled — the journal key (required for caching). */
  submissionId?: string;
  /** deterministic clock for the journal latency (tests). */
  now?: () => number;
}

/**
 * Run the payout action replay for one submission's mission. Returns a decision the settlement path enforces:
 *  - off                         → skip (byte-identical existing behavior)
 *  - non-canary campaign         → skip (no bound policy)
 *  - not an action mission       → skip
 *  - shadow                      → allow ALWAYS (journal the code; settlement unchanged)
 *  - canary + reproduced         → allow (continue; NEVER creates a payout)
 *  - canary + anything else      → hold (VETO; the caller must NOT broadcast)
 *  - canary + no valid probe     → hold (probe_not_applicable)
 *  - canary + policy fail-closed → hold (policy_missing / policy_digest_mismatch / ...)
 */
export async function runPayoutActionReplay(
  campaign: Pick<Campaign, "verificationPolicy" | "verificationPolicyDigest" | "verificationPolicyRequired" | "missionPlanDigest">,
  missionKey: string,
  deps: PayoutReplayDeps = {},
): Promise<PayoutReplayResult> {
  const mode = payoutActionReplayMode();
  const base = { mode, probeResults: [] as { probeId: string; code: PayoutReplayCode }[], isActionMission: false };
  if (mode === "off") return { ...base, decision: "skip", code: null };
  // Phase 4 — only a policy-REQUIRED campaign is gated. policyRequired=false → skip (historical behaviour).
  const required = campaign.verificationPolicyRequired === true;
  if (!required) return { ...base, decision: "skip", code: null };

  // required=true from here: fail CLOSED. A missing/malformed/incomplete/mismatched policy HOLDS (canary) —
  // never skips (defect #2). shadow journals the code but leaves settlement unchanged.
  const hold = (code: PayoutReplayCode, isAction = true): PayoutReplayResult => ({ ...base, isActionMission: isAction, decision: mode === "canary" ? "hold" : "allow", code });
  const load = loadVerifiedCampaignPolicy(campaign);
  if (!load.ok) {
    const code: PayoutReplayCode = load.reason === "policy_missing" ? "policy_missing" : "policy_digest_mismatch";
    return hold(code);
  }
  const policy = load.policy;
  // the loaded policy is COMPLETE (loadVerifiedCampaignPolicy requires it), so absence from actionCriteria
  // PROVES this mission has no action criteria → safe to skip (we never infer non-action from an incomplete policy).
  if (!policyMarksActionMission(policy, missionKey)) return { ...base, decision: "skip", code: null };

  const probes = probesForMission(policy, missionKey);
  if (probes.length === 0) {
    // an action mission with no valid probe is NOT autonomous-payout eligible.
    return hold("probe_not_applicable");
  }

  const run = deps.runProbe ?? (async (probe: InspectionProbeV1) => {
    const r = await runInspectionProbe(probe, { allowLoopback: deps.allowLoopback, egressAllowedPorts: deps.egressAllowedPorts, chromiumLauncher: deps.chromiumLauncher });
    return { classification: r.classification, reason: r.reason, probeId: r.probeId };
  });

  const journal = deps.journal;
  const sid = deps.submissionId;
  const clock = deps.now ?? (() => Date.now());
  const probeResults: { probeId: string; code: PayoutReplayCode }[] = [];
  for (const probe of probes) {
    let code: PayoutReplayCode;
    // Phase 5 — reuse a COMPLETED, FRESH, current-runner journal entry; otherwise run a fresh, read-only replay
    // under a lease (P4). A stale/old-runner/in-flight entry re-runs. complete() CAS-updates only against THIS
    // lease, so a superseded run's late completion cannot overwrite a newer one.
    const cached = journal && sid ? journal.lookup(sid, policy.policyDigest, probe.probeDigest) : null;
    const fresh = !!cached && cached.completed && cached.probeVersion === REPLAY_RUNNER_VERSION && cached.completedAt != null && Math.floor(clock() / 1000) - cached.completedAt <= MAX_PERMIT_AGE_SEC;
    if (cached && fresh) {
      code = cached.code as PayoutReplayCode;
    } else {
      const lease = journal && sid ? journal.begin(sid, policy.policyDigest, probe.probeDigest) : null;
      const started = clock();
      try {
        const r = await run(toInspectionProbe(probe));
        code = classifyReplay(r.classification, r.reason);
      } catch {
        code = "internal_error";
      }
      if (journal && sid && lease) journal.complete(lease.runId, sid, policy.policyDigest, probe.probeDigest, { decision: code === "reproduced" ? "allow" : "hold", code, latencyMs: Math.max(0, clock() - started) });
    }
    probeResults.push({ probeId: probe.probeId, code });
    if (code !== "reproduced") {
      // shadow NEVER holds (journal only); canary vetoes on the FIRST non-reproduced probe.
      return { mode, decision: mode === "canary" ? "hold" : "allow", code, probeResults, isActionMission: true };
    }
  }
  // every probe reproduced → allow the already-qualified decision to continue (creates no payout on its own).
  return { mode, decision: "allow", code: "reproduced", probeResults, isActionMission: true };
}
