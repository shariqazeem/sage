import { describe, expect, it } from "vitest";
import { ARC_LAUNCH_CHAIN, ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, GOAT_MAINNET_CHAIN_ID } from "./networks";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";

/**
 * A MAINNET PRODUCT DOES NOT DEFAULT TO A TESTNET, and it does not change its default beneath the
 * people judging it. Arc mainnet opened on 16 September 2026 and joined the registry on 26 Sep as the
 * explicit second choice; the flip that makes it the default ("arc default, goat behind an explicit
 * choice but the history stays") waits for Future Caribbean's judging to close. Until then the default
 * EVM chain — the shell chip a signed-out judge sees on /explorer, the chain a new account is born on,
 * the first button in the deploy flow — stays GOAT mainnet. Flip this test the day the flip is deliberate.
 */
describe("the default EVM rail, and the launch list", () => {
  it("is GOAT mainnet, and the launch list leads with it", () => {
    expect(DEFAULT_EVM_LAUNCH_CHAIN).toBe(GOAT_MAINNET_CHAIN_ID);
    expect(chainConfig(DEFAULT_EVM_LAUNCH_CHAIN).isMainnet).toBe(true);
    expect(LAUNCH_ENABLED_CHAINS[0]).toBe(DEFAULT_EVM_LAUNCH_CHAIN);
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
