import type { Address } from "viem";
import { buildMandatePolicy, type MandateSpec } from "./mandate";
import type { SwapSide } from "@/lib/treasury/swap-venue";

/**
 * THE SCOPED PERMITS FOR MOVING MONEY INSIDE THE ACCOUNT: a swap through one router, and sending METIS.
 *
 * Each is the full base mandate PLUS the rules for exactly one move, attached only while that move is
 * signed (scoped.ts), then the wallet is re-locked. Pure builders, so every condition is unit-tested.
 *
 * A SWAP can only ever:
 *   - call the one router (`to` pinned), with the one function its side uses;
 *   - spend at most the amount the founder confirmed (`amountIn`, or the transaction's `value`);
 *   - pay out to THIS account (`to` argument pinned to the wallet's own address), so a swap can change
 *     what the account holds but never send it anywhere else;
 *   - approve the router, and only the router, for that same amount (USDC side).
 * The route (`path`) is an array, which a Privy condition cannot pin; Sage builds it from two fixed
 * addresses (swap-venue.ts), and the recipient pin means a wrong route could cost price, never custody.
 *
 * SENDING METIS can only ever reach the one address the founder typed, for at most the amount confirmed.
 */

const toHex = (n: bigint): string => `0x${n.toString(16)}`;
const toCond = (value: string) => ({ field_source: "ethereum_transaction", field: "to", operator: "eq", value });

const APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", outputs: [{ type: "bool" }], inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }] },
];
export const SWAP_TOKENS_FOR_METIS_ABI = [
  {
    type: "function",
    name: "swapExactTokensForMetis",
    stateMutability: "nonpayable",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  },
] as const;
export const SWAP_METIS_FOR_TOKENS_ABI = [
  {
    type: "function",
    name: "swapExactMetisForTokens",
    stateMutability: "payable",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  },
] as const;

const allow = (name: string, conditions: unknown[]) => ({ name, method: "eth_signTransaction", action: "ALLOW", conditions });

export function buildSwapPolicy(m: MandateSpec, input: { side: SwapSide; router: Address; account: Address; amountIn: bigint }): Record<string, unknown> {
  const base = buildMandatePolicy(m);
  const rules = (base.rules as Array<Record<string, unknown>>).slice();
  if (input.side === "usdc_to_metis") {
    rules.push(
      allow("swap: let the router take this USDC", [
        toCond(m.usdc),
        { field_source: "ethereum_calldata", field: "approve.spender", abi: APPROVE_ABI, operator: "eq", value: input.router },
        { field_source: "ethereum_calldata", field: "approve.amount", abi: APPROVE_ABI, operator: "lte", value: toHex(input.amountIn) },
      ]),
      allow("swap: USDC to METIS, back to this account", [
        toCond(input.router),
        { field_source: "ethereum_calldata", field: "swapExactTokensForMetis.amountIn", abi: SWAP_TOKENS_FOR_METIS_ABI, operator: "lte", value: toHex(input.amountIn) },
        { field_source: "ethereum_calldata", field: "swapExactTokensForMetis.to", abi: SWAP_TOKENS_FOR_METIS_ABI, operator: "eq", value: input.account },
      ]),
    );
  } else {
    rules.push(
      allow("swap: METIS to USDC, back to this account", [
        toCond(input.router),
        { field_source: "ethereum_transaction", field: "value", operator: "lte", value: toHex(input.amountIn) },
        { field_source: "ethereum_calldata", field: "swapExactMetisForTokens.to", abi: SWAP_METIS_FOR_TOKENS_ABI, operator: "eq", value: input.account },
      ]),
    );
  }
  return { ...base, name: `${m.name}:swap`, rules };
}

export function buildSendNativePolicy(m: MandateSpec, target: Address, maxWei: bigint): Record<string, unknown> {
  const base = buildMandatePolicy(m);
  const rules = (base.rules as Array<Record<string, unknown>>).slice();
  rules.push(
    allow("send METIS to the address you chose", [
      toCond(target),
      { field_source: "ethereum_transaction", field: "value", operator: "lte", value: toHex(maxWei) },
    ]),
  );
  return { ...base, name: `${m.name}:send`, rules };
}
