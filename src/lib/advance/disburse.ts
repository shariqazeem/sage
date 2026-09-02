/**
 * DISBURSE AN ADVANCE — the one function that moves the pot's money, shared by the operator route
 * and the self-serve route so the two can never drift on the rules that bind a lender:
 *   capacity comes from the LIVE record through the published formula; one active advance per
 *   borrower; the pot escrows on Starknet against a commitment and the borrower collects by a
 *   one-time claim link (bearer cash — returned once, never persisted anywhere it can be re-read
 *   except the borrower's own history).
 */
import { advanceCapacityUsd, walletCreditSignals } from "@/lib/campaigns/credit";
import { createAdvance, recordDisbursement } from "@/lib/db/advances";
import { db } from "@/lib/db";
import { advances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { escrowPayouts } from "@/lib/starknet/claims";
import { claimUrl, mintClaimSecrets } from "@/lib/starknet/claim-link";
import { starknetConfig } from "@/lib/starknet/config";
import { siteUrl } from "@/lib/site";

export const usdToBase = (usd: number): bigint => BigInt(Math.round(usd * 100)) * BigInt(10_000);

export interface DisburseInput {
  wallet: string;
  usd: number;
  multiple: number;
  waterfallBps: number;
  dryRun?: boolean;
  /** self-serve: a failed escrow must not leave a moneyless row that locks the borrower out — drop it. */
  cleanupOnFailure?: boolean;
}

export interface DisburseDeps {
  escrow?: typeof escrowPayouts;
  mint?: typeof mintClaimSecrets;
}

export type DisburseResult =
  | { ok: true; dryRun: true; capacityUsd: number; wouldDisburseUsd: number; waterfallBps: number }
  | { ok: true; dryRun?: false; advanceId: string; capacityUsd: number; disburseTx: string; claimUrl: string }
  | { ok: false; status: number; error: string };

export async function disburseAdvance(input: DisburseInput, deps: DisburseDeps = {}): Promise<DisburseResult> {
  const wallet = input.wallet.trim();
  const usd = Number(input.usd);
  if (!wallet || !Number.isFinite(usd) || usd <= 0) return { ok: false, status: 400, error: "wallet and a positive usd amount are required" };
  if (!(input.multiple > 0) || !(input.waterfallBps > 0 && input.waterfallBps <= 10_000)) return { ok: false, status: 400, error: "terms out of range" };

  // THE PUBLISHED FORMULA BINDS THE LENDER TOO — capacity from the live record, at this moment.
  const rec = walletCreditSignals(wallet);
  if (!rec) return { ok: false, status: 409, error: "no verified work record for that wallet — capacity is $0.00" };
  const capacity = advanceCapacityUsd(rec.signals, input.multiple);
  if (usd > capacity) {
    return { ok: false, status: 409, error: `$${usd.toFixed(2)} exceeds capacity $${capacity.toFixed(2)} (= ${input.multiple}× monthly verified inflow, 90d window)` };
  }
  if (input.dryRun) return { ok: true, dryRun: true, capacityUsd: capacity, wouldDisburseUsd: usd, waterfallBps: input.waterfallBps };

  const cfg = starknetConfig();
  if (!cfg) return { ok: false, status: 503, error: "Starknet settlement is not configured" };

  // One active advance per borrower — the schema throws, we answer in words.
  let advance;
  try {
    advance = createAdvance({ borrowerWallet: wallet, principalBase: usdToBase(usd), multiple: input.multiple, waterfallBps: input.waterfallBps, potAddress: cfg.accountAddress });
  } catch (e) {
    return { ok: false, status: 409, error: e instanceof Error && /UNIQUE/i.test(e.message) ? "that wallet already has an active advance — one at a time, by design" : String(e) };
  }

  try {
    const secrets = (deps.mint ?? mintClaimSecrets)();
    const escrow = await (deps.escrow ?? escrowPayouts)(
      [{ claimCommitment: secrets.claimCommitment, refundCommitment: secrets.refundCommitment, amountBase: usdToBase(usd) }],
      Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
    );
    recordDisbursement(advance.id, { tx: escrow.transactionHash, claimCommitment: secrets.claimCommitment, claimSecret: secrets.claimSecret });
    return { ok: true, advanceId: advance.id, capacityUsd: capacity, disburseTx: escrow.transactionHash, claimUrl: claimUrl(siteUrl(), secrets.claimSecret) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (input.cleanupOnFailure) {
      db.delete(advances).where(eq(advances.id, advance.id)).run();
      return { ok: false, status: 502, error: `disbursement failed (${msg.slice(0, 160)}) — nothing was escrowed and nothing is owed; try again later` };
    }
    return { ok: false, status: 502, error: `advance ${advance.id} created but DISBURSEMENT FAILED (${msg.slice(0, 160)}) — nothing was escrowed; retry will be refused by the one-active rule until the operator voids it` };
  }
}
