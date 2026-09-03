import { decodeEventLog, getAddress, type Log } from "viem";

/**
 * A PRO PLAN IS PAID IN USDC, ON CHAIN, TO THE OPERATOR. The proof is the transfer itself: the
 * caller sends the price from their wallet to Sage's operator address and hands over the hash;
 * Sage reads the receipt and looks for exactly that transfer. No card, no processor, no invoice —
 * the same money rail the product runs on. Pure: the route reads the receipt, this decides.
 */
const TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

export interface PaymentProof {
  ok: true;
  from: string;
  to: string;
  amountBase: bigint;
}
export type PaymentCheck = PaymentProof | { ok: false; reason: string };

export function findUsdcPayment(
  logs: readonly Pick<Log, "address" | "data" | "topics">[],
  expect: { usdc: string; to: string; from: string; minBase: bigint },
): PaymentCheck {
  const usdc = expect.usdc.toLowerCase();
  let best: PaymentProof | null = null;
  for (const log of logs) {
    if (log.address.toLowerCase() !== usdc) continue;
    let ev: { from: string; to: string; value: bigint };
    try {
      const d = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "Transfer") continue;
      ev = d.args as { from: string; to: string; value: bigint };
    } catch {
      continue;
    }
    if (getAddress(ev.to) !== getAddress(expect.to)) continue;
    if (getAddress(ev.from) !== getAddress(expect.from)) continue;
    if (!best || ev.value > best.amountBase) best = { ok: true, from: ev.from, to: ev.to, amountBase: ev.value };
  }
  if (!best) return { ok: false, reason: "no USDC transfer from your wallet to Sage's operator address in that transaction" };
  if (best.amountBase < expect.minBase) return { ok: false, reason: `the transfer was ${(Number(best.amountBase) / 1e6).toFixed(2)} USDC; Pro is ${(Number(expect.minBase) / 1e6).toFixed(2)} USDC` };
  return best;
}

/** Extend from the later of now and the current expiry — paying early never loses days. */
export function extendedUntil(currentUntil: number | null, nowSec: number, periodSec: number): number {
  return Math.max(currentUntil ?? 0, nowSec) + periodSec;
}

/** Where a Pro payment goes: Sage's operator wallet on GOAT (the same one the vaults name). */
export function operatorAddress(): string | null {
  const raw = process.env.GOAT_OPERATOR_ADDRESS?.trim() || process.env.NEXT_PUBLIC_OPERATOR_ADDRESS?.trim();
  try {
    return raw ? getAddress(raw) : null;
  } catch {
    return null;
  }
}
