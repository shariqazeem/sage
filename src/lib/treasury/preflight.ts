import { chainConfig } from "@/lib/deputy/networks";
import { needsFeeMessage, SWAP_GAS_UNITS } from "./gas-policy";
/**
 * WHAT MUST BE TRUE BEFORE THE AGENT SPENDS FROM THE TREASURY. Pure, so the web route and the
 * Telegram tool cannot disagree, and so each refusal is a sentence the founder can act on.
 */
export type TreasuryPreflight =
  | { ok: true }
  | { ok: false; reason: "overCap" | "needsFunding" | "needsGas"; message: string };

const usd = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;

export function treasuryPreflight(input: { budgetBase: bigint; capBase: bigint; balanceBase: bigint; gasWei: bigint; minGasWei: bigint; address: string; chainId?: number; gasPriceWei?: bigint }): TreasuryPreflight {
  const c = chainConfig(input.chainId ?? 2345);
  if (input.budgetBase > input.capBase) {
    return { ok: false, reason: "overCap", message: `This campaign's budget is ${usd(input.budgetBase)}; the account's per-campaign cap is ${usd(input.capBase)}. Lower the budget or raise the cap.` };
  }
  if (input.balanceBase < input.budgetBase) {
    return { ok: false, reason: "needsFunding", message: `Your account holds ${usd(input.balanceBase)} USDC and this campaign needs ${usd(input.budgetBase)}. Send USDC on ${c.name} to ${input.address}.` };
  }
  if (input.gasWei < input.minGasWei) {
    // the chain's own launch floor (0.05 METIS on Metis), and a swap offered only when the account can pay for one
    const swapFeeWei = input.gasPriceWei != null ? SWAP_GAS_UNITS * input.gasPriceWei : undefined;
    return { ok: false, reason: "needsGas", message: needsFeeMessage({ chainId: c.chainId, action: "launch", needWei: input.minGasWei, haveWei: input.gasWei, swapFeeWei, nativeSymbol: c.nativeSymbol, network: c.name }) };
  }
  return { ok: true };
}
