import "server-only";
import { getAddress, type Hash } from "viem";
import { getWebTreasuryOn } from "@/lib/treasury/web";
import { withdrawViaPrivy } from "@/lib/privy/withdraw";
import { accountBalanceBase } from "@/lib/treasury/activity";
import { nativeBalanceWei } from "@/lib/telegram/agent-wallet-tools";
import { grantGasStipend } from "@/lib/treasury/gas-stipend";
import { minLaunchGasWei, operatorGasFloorWei } from "@/lib/treasury/gas-policy";
import { operatorNativeBalanceWei, sendNative } from "@/lib/deputy/native-send";
import { publicClient } from "@/lib/deputy/chain";
import { acquireLock, releaseLock } from "@/lib/db/campaigns";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import type { PlanPaymentMethod } from "@/lib/db/schema";
import { PLANS, type PlanId } from "./catalog";
import { billingAddress, isBillingChain, readPlanPayment } from "./billing";
import { applyPlanPayment, quotePlan, type Quote } from "./apply-payment";

/** A USDC transfer is ~50-60k gas; this is what one needs, with room. */
export const TRANSFER_GAS = BigInt(120_000);

/**
 * SAGE PAYS THE NETWORK FEE ON A PLAN PAYMENT, so paying for Sage from the Sage balance needs USDC
 * and nothing else, the way a card needs a balance and nothing else. Pure decision: cover exactly one
 * transfer (with a quarter of headroom) when the balance lacks it, and only while the operator keeps
 * its settlement reserve. A few tenths of a cent on Metis, against a $29 payment.
 */
export type TransferGasDecision =
  | { cover: true; amountWei: bigint }
  | { cover: false; reason: "enough" | "unpriced" | "operator_reserve" };

export function decideTransferGas(input: { gasPriceWei: bigint; gasWei: bigint; operatorGasWei: bigint; operatorFloorWei: bigint }): TransferGasDecision {
  if (input.gasPriceWei <= BigInt(0)) return { cover: false, reason: "unpriced" };
  const need = TRANSFER_GAS * input.gasPriceWei;
  if (input.gasWei >= need) return { cover: false, reason: "enough" };
  const amountWei = need + need / BigInt(4) - input.gasWei;
  if (input.operatorGasWei - amountWei < input.operatorFloorWei) return { cover: false, reason: "operator_reserve" };
  return { cover: true, amountWei };
}

export type BalancePayment =
  | { ok: true; txHash: Hash; until: number; amountUsd: number; explorerUrl: string; plan: PlanId; workspaceId: string }
  | {
      ok: false;
      code: "no_billing" | "not_billing_chain" | "no_account" | "quote" | "busy" | "insufficient" | "gas" | "send_failed" | "unconfirmed";
      error: string;
      status: number;
      /** set when money left but the receipt was not readable yet: the hash is the founder's proof. */
      txHash?: Hash;
    };

export interface PayFromBalanceDeps {
  quote?: () => Quote;
  /** told the payment's hash the moment it is sent, before its receipt is read (a renewal records it). */
  onSent?: (txHash: Hash, gasTxHash: Hash | null) => void;
}

/**
 * PAY A PLAN FROM THE SAGE BALANCE: the same scoped permit as a withdrawal (this recipient, this amount,
 * nothing else), then the wallet is re-locked to its mandate whatever happened. The receipt is READ, as
 * a wallet payment is, so the plan is extended by what the chain shows, not by what this believes it
 * sent. One payment at a time per founder: a double click, or a renewal racing a click, never pays twice.
 */
export async function payPlanFromBalance(
  input: { founder: string; plan: PlanId; chainId: number; method: Extract<PlanPaymentMethod, "balance" | "renewal"> },
  deps: PayFromBalanceDeps = {},
): Promise<BalancePayment> {
  const to = billingAddress();
  if (!to) return { ok: false, code: "no_billing", status: 503, error: "Plan payments aren't configured on this deployment." };
  if (!isBillingChain(input.chainId)) return { ok: false, code: "not_billing_chain", status: 400, error: "Plans are paid in USDC on Metis." };
  const network = chainConfig(input.chainId).name;
  const t = getWebTreasuryOn(input.founder, input.chainId);
  if (!t) return { ok: false, code: "no_account", status: 404, error: `You don't have a Sage balance on ${network} yet.` };
  const q = (deps.quote ?? (() => quotePlan(input.founder, input.plan)))();
  if (!q.ok) return { ok: false, code: "quote", status: q.status, error: q.error };

  const lock = `plan-pay:${input.founder.toLowerCase()}`;
  if (!acquireLock(lock, 180)) return { ok: false, code: "busy", status: 409, error: "A payment is already going through. Give it a moment." };
  try {
    const wallet = getAddress(t.privyWalletAddress);
    const balance = await accountBalanceBase(wallet, input.chainId);
    if (balance < q.priceBase) {
      const short = (Number(q.priceBase - balance) / 1e6).toFixed(2);
      return {
        ok: false,
        code: "insufficient",
        status: 400,
        error: `${PLANS[q.plan].name} is $${q.priceUsd} and your Sage balance on ${network} holds $${(Number(balance) / 1e6).toFixed(2)}. Add $${short} of USDC to it, or pay from a wallet.`,
      };
    }

    // The network fee, which the founder never has to find: the one-time launch stipend first (it also
    // leaves room for a launch), then exactly one transfer's worth.
    let gasTxHash: Hash | null = null;
    const gasPrice = await publicClient(input.chainId).getGasPrice().catch(() => BigInt(0));
    const gas = await nativeBalanceWei(wallet, input.chainId);
    if (gasPrice > BigInt(0) && gas < TRANSFER_GAS * gasPrice) {
      const stipend = await grantGasStipend({ chainId: input.chainId, wallet, walletUsdcBase: balance, budgetBase: q.priceBase, gasWei: gas, minGasWei: minLaunchGasWei(input.chainId) });
      if (stipend.granted) {
        gasTxHash = stipend.txHash;
      } else {
        const d = decideTransferGas({ gasPriceWei: gasPrice, gasWei: gas, operatorGasWei: await operatorNativeBalanceWei(input.chainId), operatorFloorWei: operatorGasFloorWei(input.chainId) });
        if (d.cover) {
          try {
            gasTxHash = await sendNative(input.chainId, wallet, d.amountWei);
            await publicClient(input.chainId).waitForTransactionReceipt({ hash: gasTxHash, timeout: 120_000 });
          } catch (e) {
            console.warn(`[plan-pay] network fee cover failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`);
            return { ok: false, code: "gas", status: 503, error: "Sage couldn't cover the network fee for this payment just now. Nothing was charged; try again in a minute." };
          }
        } else if (d.reason === "operator_reserve") {
          return { ok: false, code: "gas", status: 503, error: "Sage's network-fee reserve is low right now, so nothing was charged. Try again later, or pay from a wallet." };
        }
      }
    }

    let sentHash: Hash;
    try {
      const sent = await withdrawViaPrivy(t, to, q.priceBase);
      sentHash = sent.txHash as Hash;
    } catch (e) {
      return { ok: false, code: "send_failed", status: 400, error: e instanceof Error ? e.message.slice(0, 220) : "The payment didn't go through." };
    }
    deps.onSent?.(sentHash, gasTxHash);
    // The executor waited for the transaction; a node can still lag a second behind it.
    let check = await readPlanPayment({ chainId: input.chainId, txHash: sentHash, payers: [wallet], minBase: q.priceBase });
    for (let i = 0; i < 3 && !check.ok && "retryable" in check; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      check = await readPlanPayment({ chainId: input.chainId, txHash: sentHash, payers: [wallet], minBase: q.priceBase });
    }
    if (!check.ok) {
      return {
        ok: false,
        code: "unconfirmed",
        status: 202,
        txHash: sentHash,
        error: `Sent, but Sage couldn't confirm it yet (${check.reason}). It will be applied as soon as the receipt is readable; your transaction is ${sentHash}.`,
      };
    }
    applyPlanPayment(q, { txHash: sentHash, chainId: input.chainId, payer: wallet, amountBase: check.amountBase, method: input.method });
    return { ok: true, txHash: sentHash, until: q.until, amountUsd: q.priceUsd, explorerUrl: explorerTxUrl(input.chainId, sentHash), plan: q.plan, workspaceId: q.workspace.id };
  } finally {
    releaseLock(lock);
  }
}
