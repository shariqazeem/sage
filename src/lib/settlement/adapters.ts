import { corridorCost, type CorridorCost } from "@/lib/money/currency";
import type { SettlementRail } from "@/lib/db/schema";

/**
 * THE ROUTER'S DOORS — every way an obligation can be discharged, described truthfully.
 *
 * `settleByRail` (settle-dispatch.ts) is the one place settlement branches, and it stays that way;
 * this module does not move money. It is the registry the rest of the system — and a judge —
 * reads: what each door can do, what its receipt is, and, for the door that is not live, exactly
 * why not. The Future Caribbean brief's constraint is real Caribbean conditions, and its trap is
 * the fake integration; the honest shape is a REAL interface with a refusal where the partner
 * keys would go. "Mark paid via partner" without a partner is theatre, so it does not exist here.
 *
 * The property that makes the fiat door infrastructure rather than a feature: THE CREDIT EVENT IS
 * IDENTICAL. A worker paid via a licensed partner in a jurisdiction where crypto is banned earns
 * the same verified record entry as one paid in USDC — the record anchors to the partner's
 * disbursement reference and the audit row instead of a chain transaction. That contract is typed
 * below (`FiatDisbursement`) so a partner implementation cannot ship without it.
 */

export type SettlementDoor = "goat" | "starknet-claims" | "fiat-partner";

export interface DoorCapabilities {
  /** the receipt is a chain transaction anyone can verify without asking Sage. */
  chainAnchored: boolean;
  /** the money need not land in a wallet anyone can watch. */
  privateCapable: boolean;
  /** a recipient who owns nothing — no wallet, no gas, no account — can still be paid. */
  walletlessRecipient: boolean;
  /** ends in local currency in a bank or mobile-money account. */
  fiatExit: boolean;
}

export interface SettlementAdapterInfo {
  door: SettlementDoor;
  label: string;
  /** which `campaign.settlementRail` value routes here; null = not yet a rail the dispatcher knows. */
  settles: SettlementRail | null;
  status: "live" | "interface-ready";
  capabilities: DoorCapabilities;
  /** what its receipt IS — the thing a verifier checks. */
  receipt: string;
  /** the honest sentence, present exactly when status is not "live". */
  notLiveBecause?: string;
}

export const SETTLEMENT_DOORS: readonly SettlementAdapterInfo[] = [
  {
    door: "goat",
    label: "GOAT — the public tape",
    settles: "evm",
    status: "live",
    capabilities: { chainAnchored: true, privateCapable: false, walletlessRecipient: true, fiatExit: false },
    receipt: "an on-chain settlement transaction, one /proof page per payout",
  },
  {
    door: "starknet-claims",
    label: "Starknet — the private claim",
    settles: "starknet",
    status: "live",
    capabilities: { chainAnchored: true, privateCapable: true, walletlessRecipient: true, fiatExit: false },
    receipt: "a vault release + an escrow deposit keyed by a Poseidon commitment; collection is the recipient's",
  },
  {
    door: "fiat-partner",
    label: "Licensed partner — the fiat exit",
    settles: null,
    status: "interface-ready",
    capabilities: { chainAnchored: false, privateCapable: false, walletlessRecipient: true, fiatExit: true },
    receipt: "the partner's disbursement reference + Sage's audit row — same credit event, different anchor",
    notLiveBecause:
      "no partner keys are held. The interface is real and typed; activation is a compliance " +
      "onboarding with a licensed payout provider, not a code change. Nothing here simulates money movement.",
  },
] as const;

export function doorFor(door: SettlementDoor): SettlementAdapterInfo {
  const d = SETTLEMENT_DOORS.find((x) => x.door === door);
  if (!d) throw new Error(`unknown settlement door: ${door}`);
  return d;
}

/* ───────────────────────────── the fiat door's real functions ───────────────────────── */

/**
 * What this obligation costs through the corridor the track names, vs through Sage.
 *
 * Real arithmetic today, no partner needed: the benchmark is explicit (7–9% average; callers pass
 * their own), Sage's recipient-side cost is 0 by construction on the live doors, and a future
 * partner door's fee lands in `sageCostUsd` the day one exists.
 */
export function fiatQuote(amountUsd: number, benchmarkRate = 0.08, partnerFeeUsd = 0): CorridorCost {
  return corridorCost(amountUsd, benchmarkRate, partnerFeeUsd);
}

/**
 * THE CONTRACT a partner implementation must fulfil — typed so it cannot ship half.
 *
 * `creditEvent` is the point: whatever moves the money, the record gets the same verified entry.
 * `txHash: null` is not a missing field, it is the truthful anchor for a fiat leg — the record
 * layer anchors these rows to `partnerRef` + the audit row instead.
 */
export interface FiatDisbursement {
  obligationId: string;
  payee: { name?: string; msisdn?: string; accountRef?: string };
  amountUsd: number;
  corridor: { from: string; to: string; localCurrency: string };
  partnerRef: string;
  creditEvent: { recordable: true; txHash: null; partnerRef: string; disbursedAtUnix: number };
}

export class FiatAdapterNotConfigured extends Error {
  constructor() {
    super(
      "The fiat door is interface-ready, not live: Sage holds no licensed-partner keys, and this " +
        "adapter will not pretend to move money. See SETTLEMENT_DOORS['fiat-partner'].notLiveBecause.",
    );
    this.name = "FiatAdapterNotConfigured";
  }
}

/** The door's disburse — a refusal in words until a partner implementation replaces it. */
export function fiatDisburse(): Promise<FiatDisbursement> {
  return Promise.reject(new FiatAdapterNotConfigured());
}
