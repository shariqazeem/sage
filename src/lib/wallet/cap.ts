/**
 * Pure validation for the one mutation the contract allows an owner: LOWERING a
 * cap. The contract refuses anything else, and so do we — client-side, before a
 * signature is ever requested. No I/O, so it unit-tests directly.
 */
export interface CapValidation {
  ok: boolean;
  error?: string;
}

/** A cap may only be lowered. Reject equal, higher, and non-positive values. */
export function validateLowerCap(
  currentUsd: number,
  nextUsd: number,
): CapValidation {
  if (!Number.isFinite(nextUsd) || nextUsd <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  if (nextUsd >= currentUsd) {
    return {
      ok: false,
      error: "A cap can only be lowered — enter a value below the current cap.",
    };
  }
  return { ok: true };
}
