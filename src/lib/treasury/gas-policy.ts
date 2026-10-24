import { METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * GAS BY NETWORK, MEASURED, never one number for every chain.
 *
 * Until 19 Oct 2026 one constant (0.000003 of the gas token, sized for GOAT's BTC) served every chain.
 * On Metis that is 0.000003 METIS: a launch passed the gas check and then ran dry halfway through its
 * four transactions. These are the amounts that actually work, from measurements:
 * - a V2 launch is createCampaignVault (up to ~1.66M gas, forge gas report), approve (~50k), fund
 *   (~60–76k) and activate (~55k), about 1.9M gas in all;
 * - Metis Andromeda prices gas at ~13.4 gwei (eth_gasPrice, 19 Oct), so ~0.026 METIS a launch;
 * - a payout (requestPayout) is ~150k gas, ~0.002 METIS.
 * Arc is not listed: USDC is its gas, so the USDC balance check covers it.
 */
const FALLBACK_LAUNCH_GAS_WEI = BigInt("3000000000000"); // 0.000003 BTC: GOAT's 4-tx launch with headroom
const LAUNCH_GAS_WEI: Record<number, bigint> = {
  2345: FALLBACK_LAUNCH_GAS_WEI,
  [METIS_MAINNET_CHAIN_ID]: BigInt("50000000000000000"), // 0.05 METIS: about twice the measured launch
};

/** The native gas an account needs on a chain before Sage launches a campaign from it. */
export function minLaunchGasWei(chainId: number): bigint {
  return LAUNCH_GAS_WEI[chainId] ?? FALLBACK_LAUNCH_GAS_WEI;
}

/**
 * What the operator keeps for settlements before it covers anyone's launch gas (the stipend). GOAT's
 * floor is 0.000005 BTC (~170 payouts); Metis keeps 0.2 METIS (~100 payouts at ~0.002 METIS each).
 */
export function operatorGasFloorWei(chainId: number): bigint {
  if (chainId === METIS_MAINNET_CHAIN_ID) return BigInt(process.env.METIS_MAINNET_OPERATOR_GAS_FLOOR_WEI?.trim() || "200000000000000000");
  return BigInt(process.env.OPERATOR_GAS_FLOOR_WEI?.trim() || "5000000000000");
}

/**
 * WHO PAYS THE NETWORK FEE: THE ACCOUNT (24 Oct 2026, the founder's decision).
 *
 * Until now the operator covered a walletless founder's first launch (the stipend) and the fee on a
 * plan paid from the balance. Sage can't pay everyone's gas for long, and on Metis nobody has to
 * ask it to: METIS is withdrawn straight onto the Metis network from Binance and other exchanges,
 * and the fee is a fraction of a cent. So the account pays its own fee, and every door that needs
 * gas says how to get it instead of quietly sending some. The operator still pays for what only it
 * can send (settling a payout), which the job's fee covers. Set OPERATOR_COVERS_GAS=1 to bring the
 * old cover back deliberately; nothing else turns it on.
 */
export function operatorCoversGas(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPERATOR_COVERS_GAS?.trim() === "1";
}

/** Gas units, measured: a USDC transfer is ~50-60k, an approve ~46k, a Netswap swap ~130-150k. */
export const TRANSFER_GAS_UNITS = BigInt(120_000);
export const SWAP_GAS_UNITS = BigInt(320_000); // approve + swap, with room
export const NATIVE_SEND_GAS_UNITS = BigInt(60_000);

/** "0.05", "0.0023", "0": a native amount in plain digits, trimmed, never in scientific notation. */
export function formatNative(wei: bigint, digits = 4): string {
  const neg = wei < BigInt(0);
  const abs = neg ? -wei : wei;
  const whole = abs / BigInt(10) ** BigInt(18);
  const frac = (abs % BigInt(10) ** BigInt(18)).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  // a dust amount below the shown precision reads as "<0.0001", never as a misleading 0
  if (out === "0" && abs > BigInt(0)) return `<0.${"0".repeat(digits - 1)}1`;
  return neg ? `-${out}` : out;
}

export type FeeAction = "launch" | "payment" | "withdrawal" | "swap" | "send";

const ACTION_WORDS: Record<FeeAction, string> = {
  launch: "launch this job",
  payment: "pay for the plan",
  withdrawal: "send this withdrawal",
  swap: "make this swap",
  send: "send this",
};

/**
 * THE SENTENCE A FOUNDER READS WHEN THE ACCOUNT IS SHORT OF GAS, one for every door. It names the
 * token, how much is needed and held, and the two ways to get it: add METIS (an exchange withdrawal
 * on the Metis network, or any Metis wallet), or swap a little USDC inside the account when the
 * account already holds enough METIS to pay for the swap itself.
 */
export function needsFeeMessage(input: { chainId: number; action: FeeAction; needWei: bigint; haveWei: bigint; swapFeeWei?: bigint; nativeSymbol: string; network: string }): string {
  const need = formatNative(input.needWei);
  const have = formatNative(input.haveWei);
  const head = `Your account needs about ${need} ${input.nativeSymbol} for the network fee to ${ACTION_WORDS[input.action]}, and it holds ${have}.`;
  if (input.nativeSymbol === "USDC") return `${head} On ${input.network} USDC is the fee, so add a little more USDC.`;
  const canSwap = input.swapFeeWei != null && input.haveWei >= input.swapFeeWei && input.chainId === METIS_MAINNET_CHAIN_ID;
  const add = `Add ${input.nativeSymbol} to it: withdraw ${input.nativeSymbol} on the ${input.network} network from Binance, OKX or another exchange that supports it, or send it from any ${input.network} wallet.`;
  return canSwap ? `${head} Swap a little USDC to ${input.nativeSymbol} from your account, or ${add.charAt(0).toLowerCase()}${add.slice(1)}` : `${head} ${add}`;
}
