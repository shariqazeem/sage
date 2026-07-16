import "server-only";

import type { Address } from "viem";
import { privyPost } from "./client";

/**
 * The founder's MANDATE, expressed as a Privy wallet policy — the deterministic safety core. The
 * agent drives a founder's Privy wallet, but Privy's secure enclave refuses any signature outside
 * these rules, independent of anything the agent's model decided:
 *   - create a campaign vault ONLY through Sage's factory
 *   - approve / fund ONLY up to the per-campaign cap (read from DECODED calldata, not native value)
 *   - activate is allowed (moves no money)
 *   - sweep leftover ONLY back to the founder's own (SIWE-bound) reclaim address
 * Anything else is denied. Total spend is additionally bounded by the wallet's own balance — the
 * founder funds it with exactly the mandate amount, so that balance IS the lifetime cap.
 *
 * (Known v1 bound: an `approve`'s spender isn't pinned to a Sage vault, so the worst case for a
 * compromised agent is a single approve at the per-tx cap, capped further by the balance. A v2
 * "funding router" — one fixed allowlisted `to` that atomically creates+funds — closes that gap.)
 */

const toHex = (n: bigint): string => `0x${n.toString(16)}`;

// Minimal ABIs so Privy can decode the guarded functions + their capped arguments.
const APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", outputs: [{ type: "bool" }], inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }] },
];
const FUND_ABI = [
  { type: "function", name: "fund", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "amount", type: "uint256" }] },
];
const ACTIVATE_ABI = [
  { type: "function", name: "activate", stateMutability: "nonpayable", outputs: [], inputs: [] },
];
const TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", outputs: [{ type: "bool" }], inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }] },
];

export interface MandateSpec {
  /** a human label (e.g. "mandate:<founder>"). */
  name: string;
  factory: Address;
  usdc: Address;
  /**
   * The founder's own address — the ONLY place leftover funds may be swept. Omit for a WALLETLESS
   * account (the founder connected no external wallet): no sweep rule is added, so leftover simply
   * STAYS in the wallet as the account's balance, and a withdraw is a separate, chat-authorized
   * action that permits its target address at withdraw time.
   */
  reclaim?: Address;
  /** the max USDC (base units) the agent may approve/fund in a SINGLE campaign. */
  perCampaignCapBase: bigint;
}

const toCond = (value: string) => ({ field_source: "ethereum_transaction", field: "to", operator: "eq", value });

/** Build the Privy policy object encoding a mandate. Kept pure so it is unit-testable. */
export function buildMandatePolicy(m: MandateSpec): Record<string, unknown> {
  const cap = toHex(m.perCampaignCapBase);
  const allow = (name: string, conditions: unknown[]) => ({ name, method: "eth_signTransaction", action: "ALLOW", conditions });
  const rules: Array<Record<string, unknown>> = [
    allow("create vault via Sage factory", [toCond(m.factory)]),
    allow("approve up to per-campaign cap", [
      toCond(m.usdc),
      { field_source: "ethereum_calldata", field: "approve.amount", abi: APPROVE_ABI, operator: "lte", value: cap },
    ]),
    allow("fund up to per-campaign cap", [
      { field_source: "ethereum_calldata", field: "fund.amount", abi: FUND_ABI, operator: "lte", value: cap },
    ]),
    allow("activate campaign", [
      { field_source: "ethereum_calldata", field: "function_name", abi: ACTIVATE_ABI, operator: "eq", value: "activate" },
    ]),
  ];
  // A pinned-reclaim account may sweep leftover home; a walletless account keeps it as balance.
  if (m.reclaim) {
    rules.push(
      allow("sweep leftover to founder only", [
        toCond(m.usdc),
        { field_source: "ethereum_calldata", field: "transfer.to", abi: TRANSFER_ABI, operator: "eq", value: m.reclaim },
      ]),
    );
  }
  return { version: "1.0", name: m.name, chain_type: "ethereum", rules };
}

/** Create the mandate policy in Privy; returns the policy id to attach to the founder's wallet. */
export async function createMandatePolicy(m: MandateSpec): Promise<string> {
  const res = await privyPost<{ id: string }>("/policies", buildMandatePolicy(m));
  return res.id;
}

/**
 * A SCOPED withdraw policy: the full base mandate PLUS a single ALLOW to `transfer` USDC to exactly
 * one chat-authorized `target`, capped at `maxBase`. It is attached only for the duration of one
 * withdraw, then the wallet is re-locked to the base mandate. Because both the recipient and the
 * amount are pinned, even a lingering attachment can only ever move ≤ maxBase to the founder's own
 * chosen address — never anywhere else.
 */
export function buildWithdrawPolicy(m: MandateSpec, target: Address, maxBase: bigint): Record<string, unknown> {
  const base = buildMandatePolicy(m);
  const rules = (base.rules as Array<Record<string, unknown>>).slice();
  rules.push({
    name: "withdraw to a chat-authorized address",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      toCond(m.usdc),
      { field_source: "ethereum_calldata", field: "transfer.to", abi: TRANSFER_ABI, operator: "eq", value: target },
      { field_source: "ethereum_calldata", field: "transfer.amount", abi: TRANSFER_ABI, operator: "lte", value: toHex(maxBase) },
    ],
  });
  return { ...base, name: `${m.name}:withdraw`, rules };
}

/** Create the scoped withdraw policy in Privy; returns the id to briefly attach to the wallet. */
export async function createWithdrawPolicy(m: MandateSpec, target: Address, maxBase: bigint): Promise<string> {
  const res = await privyPost<{ id: string }>("/policies", buildWithdrawPolicy(m, target, maxBase));
  return res.id;
}
