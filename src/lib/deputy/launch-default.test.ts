import { describe, expect, it } from "vitest";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, GOAT_MAINNET_CHAIN_ID, isClosedNetwork, isPausedNetwork, METIS_MAINNET_CHAIN_ID, pausedNetworkReason, STARKNET_MAINNET_KEY } from "./networks";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";

/**
 * A MAINNET PRODUCT DOES NOT DEFAULT TO A TESTNET, and its default is a deliberate decision. GOAT
 * mainnet was the default from July; on 21 Oct 2026 the founder paused it for new money (its USDC
 * lost Stargate support on 23 Oct) and chose "pause GOAT, no Arc default". On 26 Oct 2026, with Metis
 * live, the founder chose ONE network: the launch list is Metis, then GOAT (listed so the accounts and
 * jobs held there stay reachable, and paused), and Arc and Starknet are CLOSED. Flip this test only
 * the day the next flip is deliberate.
 */
describe("the default EVM rail, and the launch list", () => {
  it("is Metis mainnet, the launch list leads with it, and GOAT is listed but paused", () => {
    expect(DEFAULT_EVM_LAUNCH_CHAIN).toBe(METIS_MAINNET_CHAIN_ID);
    expect(chainConfig(DEFAULT_EVM_LAUNCH_CHAIN).isMainnet).toBe(true);
    expect(LAUNCH_ENABLED_CHAINS[0]).toBe(DEFAULT_EVM_LAUNCH_CHAIN);
    expect(LAUNCH_ENABLED_CHAINS).toContain(GOAT_MAINNET_CHAIN_ID);
    expect(isPausedNetwork(GOAT_MAINNET_CHAIN_ID)).toBe(true);
    expect(isPausedNetwork(METIS_MAINNET_CHAIN_ID)).toBe(false);
    expect(pausedNetworkReason(GOAT_MAINNET_CHAIN_ID)).toMatch(/Stargate.*23 October 2026/);
  });

  it("launches on one network: Arc is closed and off the list, GOAT can resume, and no testnet at all", () => {
    expect(LAUNCH_ENABLED_CHAINS).toEqual([METIS_MAINNET_CHAIN_ID, GOAT_MAINNET_CHAIN_ID]);
    expect(isClosedNetwork(ARC_MAINNET_CHAIN_ID)).toBe(true);
    expect(isClosedNetwork(STARKNET_MAINNET_KEY)).toBe(true);
    // closed refuses everything new exactly as paused does, with its own sentence
    expect(isPausedNetwork(ARC_MAINNET_CHAIN_ID)).toBe(true);
    expect(pausedNetworkReason(ARC_MAINNET_CHAIN_ID)).toMatch(/Sage runs on Metis now/);
    expect(pausedNetworkReason(STARKNET_MAINNET_KEY)).toMatch(/claim links still pay/);
    // GOAT is paused, not closed: it shows as paused and can resume
    expect(isClosedNetwork(GOAT_MAINNET_CHAIN_ID)).toBe(false);
    expect(isClosedNetwork(METIS_MAINNET_CHAIN_ID)).toBe(false);
    // "no testnet thing" (10 Oct 2026): nothing launches or opens an account on a testnet any more
    for (const id of LAUNCH_ENABLED_CHAINS) expect(chainConfig(id).isMainnet).toBe(true);
    expect(LAUNCH_ENABLED_CHAINS).not.toContain(ARC_TESTNET_CHAIN_ID);
    expect(LAUNCH_ENABLED_CHAINS).not.toContain(59902);
    // ...but the registry still knows every network, so receipts on Arc and the testnets stay truthful
    expect(chainConfig(ARC_MAINNET_CHAIN_ID).isMainnet).toBe(true);
    expect(chainConfig(ARC_TESTNET_CHAIN_ID).isMainnet).toBe(false);
    expect(chainConfig(ARC_TESTNET_CHAIN_ID).chipLabel).toMatch(/testnet/i);
  });
});
