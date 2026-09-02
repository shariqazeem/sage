/**
 * SELF-SERVE ADVANCES — a worker takes working capital against their own verified record, from
 * their record page, with no operator in the loop. The terms are the operator's (env), the capacity
 * is the published formula on the live record, the money is the pot's, the repayment is the
 * waterfall on the borrower's next verified payouts. Armed by env, off by default — it moves money.
 */
import { advanceCapacityUsd, walletCreditSignals } from "@/lib/campaigns/credit";
import { getActiveAdvance } from "@/lib/db/advances";

export interface SelfServeTerms {
  armed: boolean;
  multiple: number;
  waterfallBps: number;
  maxUsd: number;
}

export function selfServeTerms(env: NodeJS.ProcessEnv = process.env): SelfServeTerms {
  const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    armed: env.ADVANCE_SELF_SERVE === "1",
    multiple: num(env.ADVANCE_MULTIPLE, 1),
    waterfallBps: Math.min(10_000, Math.round(num(env.ADVANCE_WATERFALL_BPS, 5000))),
    maxUsd: num(env.ADVANCE_MAX_USD, 5),
  };
}

export interface AdvanceOffer {
  wallet: string;
  terms: SelfServeTerms;
  capacityUsd: number;
  /** what the borrower can take now: min(capacity, the operator's max), floored to the cent; 0 when nothing. */
  offerUsd: number;
  active: { principalUsd: number; outstandingUsd: number } | null;
}

export function offerFor(wallet: string, env: NodeJS.ProcessEnv = process.env): AdvanceOffer | null {
  const rec = walletCreditSignals(wallet);
  if (!rec) return null;
  const terms = selfServeTerms(env);
  const capacityUsd = advanceCapacityUsd(rec.signals, terms.multiple);
  const active = getActiveAdvance(wallet);
  const offerUsd = active ? 0 : Math.floor(Math.min(capacityUsd, terms.maxUsd) * 100) / 100;
  return {
    wallet,
    terms,
    capacityUsd,
    offerUsd,
    active: active ? { principalUsd: Number(active.principalBase) / 1_000_000, outstandingUsd: Number(active.outstandingBase) / 1_000_000 } : null,
  };
}

/** Compare two wallet addresses by value across rails — checksummed EVM vs padded Starknet felts. */
export function sameWallet(a: string | null | undefined, b: string): boolean {
  try { return !!a && BigInt(a) === BigInt(b); } catch { return false; }
}
