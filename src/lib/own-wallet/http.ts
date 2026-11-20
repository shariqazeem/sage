import type { OwnWalletRefusalReason } from "./flow";

/** One HTTP status per refusal, for both own-wallet routes. */
export function ownWalletStatus(reason: OwnWalletRefusalReason): number {
  switch (reason) {
    case "not_yours":
      return 403;
    case "plan_limit":
      return 402;
    case "network_paused":
    case "not_evm":
    case "wrong_vault":
      return 400;
    case "unreadable":
      return 503;
    case "failed":
      return 500;
    default:
      return 409;
  }
}
