import "server-only";
import { getAddress, type Hash } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { operatorNativeBalanceWei, sendNative } from "@/lib/deputy/native-send";
import { getGasStipend, recordGasStipend } from "@/lib/db/gas-stipends";

/**
 * THE OPERATOR NEVER PAYS FOR A FLOW THAT PRODUCES NO FEE — AND NEVER TWICE.
 *
 * A walletless founder deposits USDC from chat and is then told to find BTC dust for gas; that is the
 * step most of them never finish. When the wallet already holds the USDC a plan needs and lacks only
 * gas, the operator sends exactly the launch floor's shortfall (capped at that floor), once per wallet,
 * and only while the operator itself keeps a reserve for settlements. The first settlement's fee
 * covers it many times over. Pure decision below; the grant records the row before returning.
 */
export const OPERATOR_GAS_FLOOR_WEI = BigInt(process.env.OPERATOR_GAS_FLOOR_WEI?.trim() || "5000000000000"); // 0.000005 BTC — ~170 payouts of settlement gas

export type StipendDecision =
  | { grant: true; amountWei: bigint }
  | { grant: false; reason: "gas_enough" | "not_funded" | "already_covered" | "operator_reserve" };

export function decideGasStipend(input: {
  walletUsdcBase: bigint;
  budgetBase: bigint;
  gasWei: bigint;
  minGasWei: bigint;
  operatorGasWei: bigint;
  alreadyCovered: boolean;
  operatorFloorWei?: bigint;
}): StipendDecision {
  if (input.gasWei >= input.minGasWei) return { grant: false, reason: "gas_enough" };
  if (input.walletUsdcBase < input.budgetBase || input.budgetBase <= BigInt(0)) return { grant: false, reason: "not_funded" };
  if (input.alreadyCovered) return { grant: false, reason: "already_covered" };
  const shortfall = input.minGasWei - input.gasWei;
  const withHeadroom = shortfall + shortfall / BigInt(10); // the shortfall, a tenth of headroom
  const amountWei = withHeadroom > input.minGasWei ? input.minGasWei : withHeadroom; // never more than the floor itself
  const floor = input.operatorFloorWei ?? OPERATOR_GAS_FLOOR_WEI;
  if (input.operatorGasWei - amountWei < floor) return { grant: false, reason: "operator_reserve" };
  return { grant: true, amountWei };
}

export interface GasStipendDeps {
  operatorGas?: (chainId: number) => Promise<bigint>;
  send?: typeof sendNative;
  waitReceipt?: (chainId: number, hash: Hash) => Promise<unknown>;
  already?: (wallet: string) => boolean;
  record?: typeof recordGasStipend;
}

export type StipendRefusal = Extract<StipendDecision, { grant: false }>["reason"] | "send_failed";
export type GasStipendResult = { granted: true; amountWei: bigint; txHash: Hash } | { granted: false; reason: StipendRefusal };

/** Cover a wallet's launch gas, once, against the USDC it already holds. Waits for the transfer to land. */
export async function grantGasStipend(
  input: { chainId?: number; wallet: string; walletUsdcBase: bigint; budgetBase: bigint; gasWei: bigint; minGasWei: bigint },
  deps: GasStipendDeps = {},
): Promise<GasStipendResult> {
  const chainId = input.chainId ?? 2345;
  const wallet = getAddress(input.wallet);
  const operatorGasWei = await (deps.operatorGas ?? operatorNativeBalanceWei)(chainId);
  const d = decideGasStipend({ ...input, operatorGasWei, alreadyCovered: (deps.already ?? ((w) => getGasStipend(w) !== null))(wallet) });
  if (!d.grant) return { granted: false, reason: d.reason };
  try {
    const txHash = await (deps.send ?? sendNative)(chainId, wallet, d.amountWei);
    await (deps.waitReceipt ?? ((c, h) => publicClient(c).waitForTransactionReceipt({ hash: h, timeout: 120_000 })))(chainId, txHash);
    (deps.record ?? recordGasStipend)({ wallet, chainId, amountWei: d.amountWei, txHash, budgetBase: input.budgetBase });
    console.log(`[gas-stipend] covered ${wallet} with ${d.amountWei} wei on ${chainId} (${txHash})`);
    return { granted: true, amountWei: d.amountWei, txHash };
  } catch (e) {
    console.warn(`[gas-stipend] send failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`);
    return { granted: false, reason: "send_failed" };
  }
}

/** The sentence a founder reads when the operator did not cover the gas — each reason is something they can act on. */
export function gasRefusalMessage(reason: StipendRefusal, wallet: string): string {
  switch (reason) {
    case "already_covered":
      return `Sage covered this wallet's launch gas once already. Send about 0.00001 BTC (GOAT's gas token) to ${wallet}, then try again.`;
    case "operator_reserve":
      return `Sage's gas reserve is low right now, so it could not cover the launch gas. Send about 0.00001 BTC to ${wallet}, or try again later.`;
    case "send_failed":
      return `Sage tried to cover the launch gas and the transfer did not land. Try again in a minute, or send about 0.00001 BTC to ${wallet}.`;
    default:
      return `The agent wallet needs a little native BTC for gas (BTC is GOAT's gas token). Ask the founder to send about 0.00001 BTC to ${wallet}, then try again.`;
  }
}
