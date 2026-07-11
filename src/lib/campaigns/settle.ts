/**
 * Public settlement surface — a thin, stable re-export so callers import from one
 * place regardless of the internal split:
 *
 *   - `settle-core.ts`     — the FROZEN V1 (PolicyVault) primitives + SettleOutcome.
 *   - `vault-strategy.ts`  — the vault-agnostic seam: strategy selection over the
 *                            campaign's persisted vaultKind, and the crash-safe
 *                            recovery orchestration that settles V1 or V2 alike.
 *
 * This module deliberately holds NO logic. It exists so `@/lib/campaigns/settle`
 * keeps meaning "settle an approved submission" for every existing importer.
 */

export {
  derivePayoutIntent,
  outcomeFromAttempt,
  outcomeFromSpend,
  settleSubmission,
  type PayoutIntent,
  type SettleOutcome,
} from "./settle-core";

export {
  settleWithRecovery,
  settleWithRecoveryVia,
  selectVaultStrategy,
  toSettleOutcome,
  PolicyVaultV1Strategy,
  CampaignVaultV2Strategy,
  VaultAgreementError,
  SettlementIntegrityError,
  AmbiguousBroadcastError,
  type VaultStrategy,
  type VaultStrategyDeps,
  type NormalizedOutcome,
  type SettlementPlan,
} from "./vault-strategy";
