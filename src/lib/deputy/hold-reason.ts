import type { DecisionBrief } from "./brain-core";
import { WORKPROOF_VERIFIER_MODEL } from "./work-proof";

/**
 * A HOLD SAYS ITS REAL REASON.
 *
 * The frozen gate (autopilot.ts) answers every non-LLM brief with "LLM pending — Sage holds until
 * verification is available". That is true when the judge was unreachable. It is false for a
 * DETERMINISTIC hold, where no model was ever asked because Sage's own check already said no:
 * - the transaction didn't match;
 * - the page lacked the wallet;
 * - the deliverable was a copy;
 * - the mission couldn't be bound.
 *
 * The founder read "LLM pending" on work that had already failed its proof and waited for a verdict that
 * had been given (found 5 Nov 2026). The gate stays frozen; the journal says the true thing.
 */
const DETERMINISTIC_SIGNALS = new Set(["mission context unavailable", "public identity unverified", "duplicate artifact content"]);

export function honestHoldReason(gateReason: string, brief: Pick<DecisionBrief, "engine" | "model" | "summary" | "fraudSignals" | "recommendation">): string {
  if (brief.engine === "llm" || !/^LLM pending/.test(gateReason)) return gateReason;
  const deterministic =
    brief.model === WORKPROOF_VERIFIER_MODEL || brief.fraudSignals.some((f) => DETERMINISTIC_SIGNALS.has(f.signal));
  if (!deterministic) return gateReason; // the judge really was unavailable: the gate's words are true
  const summary = (brief.summary ?? "").replace(/\s+/g, " ").trim();
  return summary ? summary.slice(0, 280) : gateReason;
}
