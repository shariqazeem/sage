/**
 * Autopilot's PURE decision logic — the gate that decides whether the Deputy may
 * auto-pay, the compare-and-set transition model, and the singleton-lock model.
 * No I/O, no `server-only`, so every rule is unit-testable in isolation. The
 * server pipeline (pipeline.ts) composes these; the vault still enforces on-chain.
 *
 * The principle, encoded: THE HUMAN CONFIRMS POLICY ONCE (autonomy = 'autopilot'
 * + threshold), THE DEPUTY ACTS INSIDE IT (this gate), THE VAULT ENFORCES (every
 * spend is a real requestSpend the vault can still reject).
 */

import type { DecisionBrief } from "./brain-core";
import { CHAINS } from "./networks";

export interface GateInput {
  autonomy: string; // "manual" | "autopilot"
  status: string; // must be "pending" to act
  engine: "llm" | "heuristic";
  recommendation: "pay" | "review" | "hold";
  confidence: number; // 0..1
  threshold: number; // 0..1
  hasHighFraud: boolean;
  /** the campaign's chain. Any chain carrying real money carries an extra safety gate. */
  chainId?: number;
  /** DEPUTY_AUTOPILOT_MAINNET — must be true for the Deputy to auto-pay real money. */
  mainnetAutopilotEnabled?: boolean;
}

export interface GateResult {
  pay: boolean;
  /** The reason — shown verbatim as the "Held by Deputy — <reason>" chip. */
  reason: string;
}

const pct = (n: number) =>
  `${Math.round(Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)) * 100)}%`;

/**
 * Does this chain move real money?
 *
 * An UNKNOWN chain counts as real. A campaign can only carry an id this does not recognise
 * through a misconfiguration or a chain added without updating the registry, and of the two
 * possible wrong answers, "treat play money as real" costs a manual approval while "treat real
 * money as play" spends someone else's USDC unattended.
 */
const isRealMoney = (chainId?: number): boolean => {
  if (chainId == null) return false; // no chain named: the pre-existing default path, unchanged
  return CHAINS[chainId]?.isMainnet ?? true;
};

/**
 * The exact autopilot gate. Returns pay=true only when ALL hold:
 *   autonomy === 'autopilot' AND status === 'pending' AND engine === 'llm'
 *   AND recommendation === 'pay' AND no high-severity fraud signal
 *   AND confidence >= threshold.
 * The engine check is the honesty rule: the heuristic (keyless) engine is
 * advisory-only and can NEVER auto-pay — with no LLM key, autopilot holds.
 */
export function autopilotGate(i: GateInput): GateResult {
  if (i.autonomy !== "autopilot") return { pay: false, reason: "manual review" };
  if (i.status !== "pending") return { pay: false, reason: "already handled" };
  // Mainnet safety sequencing: real money auto-pays ONLY once DEPUTY_AUTOPILOT_MAINNET is
  // flipped on. Until then a mainnet campaign holds for manual approval — the red-team pass is
  // what arms it.
  //
  // ASKED OF THE REGISTRY, NOT OF A LITERAL. This was written as `chainId === 2345` when GOAT was
  // the only real-money chain, which quietly made the invariant false for every mainnet added
  // afterwards: Metis Andromeda and Starknet both auto-paid real USDC with this switch off. The
  // registry already records which chains are real, so asking it means the next chain added is
  // covered by default instead of reopening this hole.
  if (isRealMoney(i.chainId) && !i.mainnetAutopilotEnabled) {
    return {
      pay: false,
      reason: "mainnet autopilot is off — approve this real-money payout manually",
    };
  }
  if (i.engine !== "llm") {
    return {
      pay: false,
      reason: "LLM pending — Sage holds until verification is available",
    };
  }
  if (i.recommendation !== "pay") {
    return { pay: false, reason: `Deputy recommends ${i.recommendation}` };
  }
  if (i.hasHighFraud) {
    return { pay: false, reason: "high-severity fraud signal" };
  }
  if (i.confidence < i.threshold) {
    return {
      pay: false,
      reason: `confidence ${pct(i.confidence)} below the ${pct(i.threshold)} autopilot threshold`,
    };
  }
  return { pay: true, reason: `verified at ${pct(i.confidence)} — within policy` };
}

/** Build a gate result from a stored brief + the campaign's mandate + status. */
export function gateFromBrief(
  brief: DecisionBrief,
  campaign: { autonomy: string; autopilotThreshold: number; chainId?: number },
  status: string,
  mainnetAutopilotEnabled = false,
): GateResult {
  return autopilotGate({
    autonomy: campaign.autonomy,
    status,
    engine: brief.engine,
    recommendation: brief.recommendation,
    confidence: brief.confidence,
    threshold: campaign.autopilotThreshold,
    hasHighFraud: brief.fraudSignals.some((f) => f.severity === "high"),
    chainId: campaign.chainId,
    mainnetAutopilotEnabled,
  });
}

/**
 * The compare-and-set model: a transition is allowed only from the exact
 * expected state. The DB enforces this atomically (UPDATE … WHERE status = from);
 * this pure model documents + tests the rule.
 */
export function casOutcome(
  current: string,
  from: string,
  to: string,
): { changed: boolean; status: string } {
  return current === from
    ? { changed: true, status: to }
    : { changed: false, status: current };
}

/**
 * The singleton-lock model: acquire only if no live holder (no row, or expired).
 * The DB does this atomically via an upsert whose UPDATE is gated on expiry.
 */
export function lockOutcome(
  existingExpiry: number | null,
  now: number,
  ttlSec: number,
): { acquired: boolean; expiresAt: number } {
  const expiresAt = now + ttlSec;
  if (existingExpiry == null || existingExpiry <= now) {
    return { acquired: true, expiresAt };
  }
  return { acquired: false, expiresAt: existingExpiry };
}
