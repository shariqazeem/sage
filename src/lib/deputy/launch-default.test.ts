import { describe, expect, it } from "vitest";
import { ARC_LAUNCH_CHAIN, ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, GOAT_MAINNET_CHAIN_ID, isPausedNetwork, METIS_MAINNET_CHAIN_ID, pausedNetworkReason } from "./networks";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";

/**
 * A MAINNET PRODUCT DOES NOT DEFAULT TO A TESTNET, and its default is a deliberate decision. GOAT
 * mainnet was the default from July; on 21 Oct 2026 the founder paused it for new money (its USDC
 * loses Stargate support on 23 Oct) and chose "pause GOAT, no Arc default": the default is Metis,
 * the launch list leads with it, GOAT stays listed (its accounts must stay reachable) but is paused,
 * and Arc stays an explicit choice. Flip this test only the day the next flip is deliberate.
 */
describe("the default EVM rail, and the launch list", () => {
  it("is Metis mainnet, the launch list leads with it, and GOAT is listed but paused", () => {
    expect(DEFAULT_EVM_LAUNCH_CHAIN).toBe(METIS_MAINNET_CHAIN_ID);
    expect(chainConfig(DEFAULT_EVM_LAUNCH_CHAIN).isMainnet).toBe(true);
    expect(LAUNCH_ENABLED_CHAINS[0]).toBe(DEFAULT_EVM_LAUNCH_CHAIN);
    expect(LAUNCH_ENABLED_CHAINS).toContain(GOAT_MAINNET_CHAIN_ID);
    expect(isPausedNetwork(GOAT_MAINNET_CHAIN_ID)).toBe(true);
    expect(isPausedNetwork(METIS_MAINNET_CHAIN_ID)).toBe(false);
    expect(isPausedNetwork(ARC_MAINNET_CHAIN_ID)).toBe(false);
    expect(pausedNetworkReason(GOAT_MAINNET_CHAIN_ID)).toMatch(/Stargate.*23 October 2026/);
  });

  it("offers Arc mainnet second, as a mainnet, and no testnet at all", () => {
    expect(ARC_LAUNCH_CHAIN).toBe(ARC_MAINNET_CHAIN_ID);
    expect(LAUNCH_ENABLED_CHAINS).toContain(ARC_LAUNCH_CHAIN);
    expect(LAUNCH_ENABLED_CHAINS.indexOf(ARC_LAUNCH_CHAIN)).toBeGreaterThan(LAUNCH_ENABLED_CHAINS.indexOf(DEFAULT_EVM_LAUNCH_CHAIN));
    const arc = chainConfig(ARC_LAUNCH_CHAIN);
    expect(arc.isMainnet).toBe(true);
    expect(arc.chipLabel).not.toMatch(/testnet/i);
    // "no testnet thing" (10 Oct 2026): nothing launches or opens an account on a testnet any more
    for (const id of LAUNCH_ENABLED_CHAINS) expect(chainConfig(id).isMainnet).toBe(true);
    expect(LAUNCH_ENABLED_CHAINS).not.toContain(ARC_TESTNET_CHAIN_ID);
    expect(LAUNCH_ENABLED_CHAINS).not.toContain(59902);
    // ...but the registry still knows the testnet, so a campaign already on it resolves and says what it is
    expect(chainConfig(ARC_TESTNET_CHAIN_ID).isMainnet).toBe(false);
    expect(chainConfig(ARC_TESTNET_CHAIN_ID).chipLabel).toMatch(/testnet/i);
  });
});
