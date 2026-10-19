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
