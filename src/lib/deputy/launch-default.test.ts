import { describe, expect, it } from "vitest";
import { ARC_LAUNCH_CHAIN, chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, GOAT_MAINNET_CHAIN_ID } from "./networks";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";

/**
 * A MAINNET PRODUCT DOES NOT DEFAULT TO A TESTNET. Arc is supported end to end, and it is on testnet
 * until 16 September 2026; until Arc mainnet is in the registry, the default EVM chain — the shell
 * chip a signed-out judge sees on /explorer, the chain a new account is born on, the first button in
 * the deploy flow — must be a mainnet. The founder's rule of 2026-09-10: "keep it separate and keep
 * strk20 and goat primary, until we goes mainnet". Flip this test the day the flip is deliberate.
 */
describe("the default EVM rail while Arc is on testnet", () => {
  it("is GOAT mainnet, and the launch list leads with it", () => {
    expect(DEFAULT_EVM_LAUNCH_CHAIN).toBe(GOAT_MAINNET_CHAIN_ID);
    expect(chainConfig(DEFAULT_EVM_LAUNCH_CHAIN).isMainnet).toBe(true);
    expect(LAUNCH_ENABLED_CHAINS[0]).toBe(DEFAULT_EVM_LAUNCH_CHAIN);
  });

  it("keeps Arc reachable, second, and labelled as the testnet it is", () => {
    expect(LAUNCH_ENABLED_CHAINS).toContain(ARC_LAUNCH_CHAIN);
    expect(LAUNCH_ENABLED_CHAINS.indexOf(ARC_LAUNCH_CHAIN)).toBeGreaterThan(LAUNCH_ENABLED_CHAINS.indexOf(DEFAULT_EVM_LAUNCH_CHAIN));
    const arc = chainConfig(ARC_LAUNCH_CHAIN);
    expect(arc.isMainnet).toBe(false);
    expect(arc.chipLabel).toMatch(/testnet/i);
  });
});
