/**
 * SELF-SERVE ADVANCES — a worker takes working capital against their own verified record, from
 * their record page, with no operator in the loop. The terms are the operator's (env), the capacity
 * is the published formula on the live record, the money is the pot's, the repayment is the
 * waterfall on the borrower's next verified payouts. Armed by env, off by default — it moves money.
 */
import { advanceCapacityUsd, walletCreditSignals } from "@/lib/campaigns/credit";
import { getActiveAdvance, getFeeTopup } from "@/lib/db/advances";
import { allowanceToPot, approvalFeeWei, metisBalanceOf, MIN_ADVANCE_BASE, POT_MIN_METIS_WEI, potBalances, potConfig, type PotConfigResult } from "./pot";

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

/**
 * THE OFFER, AS THE POT CAN PAY IT (26 Oct 2026: advances on Metis).
 *
 * The formula says what a record supports; the pot says what exists to lend. An advance is offered only
 * when both agree: the offer is the formula's, capped by the pot's USDC, and while the pot cannot pay (not
 * set up, empty, short of METIS for its own fees, or unreachable) the page says so in one calm sentence and
 * offers nothing, rather than a button that fails. The borrower's one approval is read from the chain here
 * too, so the page knows which step comes next.
 */
export const POT_PAUSED =
  "Advances are paused while the lending pot is topped up. Your capacity is worked out live from your verified record, so nothing is lost: check back soon.";
export const POT_UNREACHABLE = "Advances are briefly unavailable. Please check back in a few minutes.";
export const NOT_ON_METIS = "Advances are paid on Metis, to an Ethereum-style wallet; this record's wallet is on Starknet.";

export type PotState = { open: true; address: string; token: string; availableUsd: number } | { open: false; message: string };

export interface ApprovalState {
  /** what the borrower has approved the pot to collect, in base units. */
  allowanceBase: string;
  /** whether that covers the advance on offer. */
  approved: boolean;
  /** whether the pot should cover this approval's fee first (no METIS in the wallet, not covered before). */
  needsFee: boolean;
}

export interface PotOffer extends AdvanceOffer {
  pot: PotState;
  approval: ApprovalState | null;
}

export interface PotOfferDeps {
  config?: () => PotConfigResult;
  balances?: (pot: { address: `0x${string}`; token: `0x${string}` }) => Promise<{ usdcBase: bigint; metisWei: bigint }>;
  allowance?: (pot: { address: `0x${string}`; token: `0x${string}` }, owner: `0x${string}`) => Promise<bigint>;
  metisOf?: (owner: `0x${string}`) => Promise<bigint>;
  feeWei?: () => Promise<bigint>;
  feeCovered?: (wallet: string) => boolean;
}

export async function offerWithPot(wallet: string, deps: PotOfferDeps = {}, env: NodeJS.ProcessEnv = process.env): Promise<PotOffer | null> {
  const base = offerFor(wallet, env);
  if (!base) return null;
  const closed = (message: string): PotOffer => ({ ...base, offerUsd: 0, pot: { open: false, message }, approval: null });
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet.trim())) return closed(NOT_ON_METIS);

  const cfg = (deps.config ?? potConfig)();
  if (!cfg.ok) return closed(POT_PAUSED);
  const owner = wallet.trim().toLowerCase() as `0x${string}`;
  try {
    const [held, allowanceBase, metisWei] = await Promise.all([
      (deps.balances ?? potBalances)(cfg.pot),
      (deps.allowance ?? allowanceToPot)(cfg.pot, owner),
      (deps.metisOf ?? metisBalanceOf)(owner),
    ]);
    if (held.metisWei < POT_MIN_METIS_WEI || held.usdcBase < MIN_ADVANCE_BASE) return closed(POT_PAUSED);
    const availableUsd = Number(held.usdcBase) / 1_000_000;
    // The formula's offer, capped by what the pot holds, floored to the cent.
    const offerUsd = Math.floor(Math.min(base.offerUsd, availableUsd) * 100) / 100;
    const wantBase = BigInt(Math.round(offerUsd * 100)) * BigInt(10_000);
    const approved = wantBase > BigInt(0) && allowanceBase >= wantBase;
    const feeWei = approved ? BigInt(0) : await (deps.feeWei ?? approvalFeeWei)();
    const covered = (deps.feeCovered ?? ((w: string) => !!getFeeTopup(w)))(owner);
    return {
      ...base,
      offerUsd,
      pot: { open: true, address: cfg.pot.address, token: cfg.pot.token, availableUsd },
      approval: { allowanceBase: allowanceBase.toString(), approved, needsFee: !approved && metisWei < feeWei && !covered },
    };
  } catch {
    return closed(POT_UNREACHABLE);
  }
}
