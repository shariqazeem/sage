/**
 * DISBURSE AN ADVANCE — the one function that moves the pot's money out, shared by the operator route
 * and the self-serve route so the two can never drift on the rules that bind a lender:
 *   capacity comes from the LIVE record through the published formula; one active advance per borrower;
 *   the pot must hold it; and the borrower must already have approved the pot to collect it back.
 *
 * ON METIS SINCE 26 OCT 2026. The advance is a plain m.USDC transfer from the pot to the borrower's own
 * wallet (the Starknet version escrowed it behind a claim link). The approval comes FIRST because repayment
 * is collected from the borrower's next verified payouts under it (collect.ts): an advance sent before the
 * approval would have no way home. The transaction hash is written the moment the node accepts it, so a
 * crash while waiting can never leave money out with no record.
 */
import { getAddress, type Address, type Hash } from "viem";
import { advanceCapacityUsd, walletCreditSignals } from "@/lib/campaigns/credit";
import { createAdvance, recordDisbursement, voidUndisbursedAdvance } from "@/lib/db/advances";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { allowanceToPot, POT_CHAIN_ID, POT_MIN_METIS_WEI, potBalances, potConfig, potReceipt, potSendUsdc, type PotConfig } from "./pot";

export const usdToBase = (usd: number): bigint => BigInt(Math.round(usd * 100)) * BigInt(10_000);

export interface DisburseInput {
  wallet: string;
  usd: number;
  multiple: number;
  waterfallBps: number;
  dryRun?: boolean;
}

export interface DisburseDeps {
  pot?: PotConfig | null;
  balances?: (pot: PotConfig) => Promise<{ usdcBase: bigint; metisWei: bigint }>;
  allowance?: (pot: PotConfig, owner: Address) => Promise<bigint>;
  send?: (pot: PotConfig, to: Address, amountBase: bigint) => Promise<Hash>;
  receipt?: (hash: Hash) => Promise<"success" | "reverted">;
}

export type DisburseResult =
  | { ok: true; dryRun: true; capacityUsd: number; wouldDisburseUsd: number; waterfallBps: number }
  | { ok: true; dryRun?: false; advanceId: string; capacityUsd: number; disburseTx: string; explorerUrl: string; confirming?: boolean }
  | { ok: false; status: number; error: string };

export async function disburseAdvance(input: DisburseInput, deps: DisburseDeps = {}): Promise<DisburseResult> {
  const wallet = input.wallet.trim();
  const usd = Number(input.usd);
  if (!wallet || !Number.isFinite(usd) || usd <= 0) return { ok: false, status: 400, error: "wallet and a positive usd amount are required" };
  if (!(input.multiple > 0) || !(input.waterfallBps > 0 && input.waterfallBps <= 10_000)) return { ok: false, status: 400, error: "terms out of range" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ok: false, status: 409, error: "Advances are paid on Metis, to an Ethereum-style wallet." };

  // THE PUBLISHED FORMULA BINDS THE LENDER TOO — capacity from the live record, at this moment.
  const rec = walletCreditSignals(wallet);
  if (!rec) return { ok: false, status: 409, error: "no verified work record for that wallet — capacity is $0.00" };
  const capacity = advanceCapacityUsd(rec.signals, input.multiple);
  if (usd > capacity) {
    return { ok: false, status: 409, error: `$${usd.toFixed(2)} exceeds capacity $${capacity.toFixed(2)} (= ${input.multiple}× monthly verified inflow, 90d window)` };
  }
  if (input.dryRun) return { ok: true, dryRun: true, capacityUsd: capacity, wouldDisburseUsd: usd, waterfallBps: input.waterfallBps };

  const configured = deps.pot !== undefined ? (deps.pot ? { ok: true as const, pot: deps.pot } : { ok: false as const }) : potConfig();
  if (!configured.ok) return { ok: false, status: 503, error: "Advances are paused while the lending pot is set up." };
  const pot = configured.pot;
  const borrower = getAddress(wallet);
  const principal = usdToBase(usd);

  // The pot must hold it, and keep enough METIS to pay its own fee.
  const held = await (deps.balances ?? potBalances)(pot);
  if (held.usdcBase < principal || held.metisWei < POT_MIN_METIS_WEI) {
    return { ok: false, status: 503, error: "Advances are paused while the lending pot is topped up. Check back soon." };
  }
  // The way home first: the borrower's approval must cover it before a cent goes out.
  const approved = await (deps.allowance ?? allowanceToPot)(pot, borrower);
  if (approved < principal) {
    return { ok: false, status: 409, error: `Approve repayment first: the pot collects up to $${usd.toFixed(2)} from your next verified payouts, ${input.waterfallBps / 100}% of each.` };
  }

  // One active advance per borrower — the schema throws, we answer in words.
  let advance;
  try {
    advance = createAdvance({ borrowerWallet: wallet, principalBase: principal, multiple: input.multiple, waterfallBps: input.waterfallBps, potAddress: pot.address, chainId: POT_CHAIN_ID });
  } catch (e) {
    return { ok: false, status: 409, error: e instanceof Error && /UNIQUE/i.test(e.message) ? "that wallet already has an active advance — one at a time, by design" : String(e) };
  }

  let hash: Hash;
  try {
    hash = await (deps.send ?? potSendUsdc)(pot, borrower, principal);
  } catch (e) {
    voidUndisbursedAdvance(advance.id);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: `the advance could not be sent (${msg.slice(0, 140)}). Nothing moved and nothing is owed; try again later.` };
  }
  // Written before the wait: from here the advance is on chain, whatever happens to this request.
  recordDisbursement(advance.id, { tx: hash });
  const explorerUrl = explorerTxUrl(POT_CHAIN_ID, hash);
  try {
    if ((await (deps.receipt ?? potReceipt)(hash)) === "reverted") {
      voidUndisbursedAdvance(advance.id);
      return { ok: false, status: 502, error: "the transfer reverted on chain. Nothing moved and nothing is owed; try again later." };
    }
  } catch {
    // Sent, not yet confirmed: the row stands (the money is most likely on its way) and says so.
    return { ok: true, advanceId: advance.id, capacityUsd: capacity, disburseTx: hash, explorerUrl, confirming: true };
  }
  return { ok: true, advanceId: advance.id, capacityUsd: capacity, disburseTx: hash, explorerUrl };
}
