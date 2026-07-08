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

export interface GateInput {
  autonomy: string; // "manual" | "autopilot"
  status: string; // must be "pending" to act
  engine: "llm" | "heuristic";
  recommendation: "pay" | "review" | "hold";
  confidence: number; // 0..1
  threshold: number; // 0..1
  hasHighFraud: boolean;
  /** the campaign's chain. 2345 (GOAT mainnet) carries an extra safety gate. */
  chainId?: number;
  /** DEPUTY_AUTOPILOT_MAINNET — must be true for the Deputy to auto-pay on 2345. */
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
  // Mainnet safety sequencing: real money on GOAT (2345) auto-pays ONLY once
  // DEPUTY_AUTOPILOT_MAINNET is flipped on. Until then a mainnet campaign holds
  // for manual approval — the red-team pass is what arms it.
  if (i.chainId === 2345 && !i.mainnetAutopilotEnabled) {
    return {
      pay: false,
      reason: "mainnet autopilot is off — approve this real-money payout manually",
    };
  }
  if (i.engine !== "llm") {
    return {
      pay: false,
      reason: "LLM pending — the Deputy holds until verification is available",
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
