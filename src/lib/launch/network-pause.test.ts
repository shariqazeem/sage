import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ARC_MAINNET_CHAIN_ID, GOAT_MAINNET_CHAIN_ID, METIS_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY, isClosedNetwork, isPausedNetwork, pausedNetworkReason } from "@/lib/deputy/networks";
import { configuredLaunchChains, defaultLaunchChain, isLaunchChain, launchChainConfig, launchClosedReason } from "./deployment-service";
import { billingChains, isBillingChain } from "@/lib/plans/billing";

/**
 * GOAT IS PAUSED FOR NEW MONEY (21 Oct 2026), AND SAGE RUNS ON ONE NETWORK, METIS (26 Oct 2026).
 *
 * GOAT Network's USDC is Stargate's bridged USDC, and Stargate ended support for GOAT on 23 October
 * 2026. The founder chose "pause GOAT, no Arc default", then one network: Arc and Starknet closed.
 * What these hold:
 * - a paused or closed network is CONFIGURED (its accounts, withdrawals and stops still work) and yet
 *   no door offers it, opens an account on it, or bills on it;
 * - the default is Metis even before Metis is live, so nothing quietly falls back to Arc;
 * - Arc, even fully configured, is offered to nobody: closing it is not undone by its env.
 */
const ENV = ["GOAT_CAMPAIGN_FACTORY_ADDRESS", "GOAT_OPERATOR_ADDRESS", "ARC_MAINNET_CAMPAIGN_FACTORY_ADDRESS", "ARC_MAINNET_OPERATOR_ADDRESS", "METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS", "METIS_MAINNET_OPERATOR_ADDRESS"] as const;
const saved: Record<string, string | undefined> = {};
const A = (c: string) => `0x${c.repeat(40)}`;

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  // GOAT and Arc fully configured; Metis not yet (its factory isn't deployed)
  process.env.GOAT_CAMPAIGN_FACTORY_ADDRESS = A("1");
  process.env.GOAT_OPERATOR_ADDRESS = A("2");
  process.env.ARC_MAINNET_CAMPAIGN_FACTORY_ADDRESS = A("3");
  process.env.ARC_MAINNET_OPERATOR_ADDRESS = A("4");
  delete process.env.METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS;
  delete process.env.METIS_MAINNET_OPERATOR_ADDRESS;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("a paused network", () => {
  it("GOAT is paused, with a reason a person can act on; Metis is open; Arc and Starknet are closed", () => {
    expect(isPausedNetwork(GOAT_MAINNET_CHAIN_ID)).toBe(true);
    expect(pausedNetworkReason(GOAT_MAINNET_CHAIN_ID)).toMatch(/Stargate.*23 October 2026.*withdraw/);
    expect(isPausedNetwork(METIS_MAINNET_CHAIN_ID)).toBe(false);
    for (const id of [ARC_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY]) {
      expect(isClosedNetwork(id)).toBe(true);
      expect(isPausedNetwork(id)).toBe(true); // every door that refuses a paused network refuses it
      expect(pausedNetworkReason(id)).toMatch(/Sage runs on Metis now/);
    }
  });

  it("stays configured, so existing accounts keep their withdrawals and stops, yet no door launches or opens there", () => {
    expect(launchChainConfig(GOAT_MAINNET_CHAIN_ID).configured).toBe(true);
    expect(isLaunchChain(GOAT_MAINNET_CHAIN_ID)).toBe(false);
    expect(configuredLaunchChains()).not.toContain(GOAT_MAINNET_CHAIN_ID);
    expect(launchClosedReason(GOAT_MAINNET_CHAIN_ID)).toBe(pausedNetworkReason(GOAT_MAINNET_CHAIN_ID));
  });

  it("is never billed on: plans are paid on Metis only", () => {
    expect(billingChains()).toEqual([METIS_MAINNET_CHAIN_ID]);
    expect(isBillingChain(GOAT_MAINNET_CHAIN_ID)).toBe(false);
    expect(isBillingChain(ARC_MAINNET_CHAIN_ID)).toBe(false);
  });
});

describe("the default, before and after Metis opens", () => {
  it("is Metis even while Metis isn't live: no quiet fallback to Arc, and the door says why", () => {
    expect(defaultLaunchChain()).toBe(METIS_MAINNET_CHAIN_ID);
    expect(isLaunchChain(METIS_MAINNET_CHAIN_ID)).toBe(false);
    expect(launchClosedReason(METIS_MAINNET_CHAIN_ID)).toMatch(/opening on Metis/);
    // Arc is configured here, and still closed: nothing to pick instead
    expect(configuredLaunchChains()).toEqual([]);
    expect(isLaunchChain(ARC_MAINNET_CHAIN_ID)).toBe(false);
    expect(launchClosedReason(ARC_MAINNET_CHAIN_ID)).toMatch(/Sage runs on Metis now/);
  });

  it("the moment Metis is configured it opens, the only network in every picker", () => {
    process.env.METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS = A("5");
    process.env.METIS_MAINNET_OPERATOR_ADDRESS = A("6");
    expect(isLaunchChain(METIS_MAINNET_CHAIN_ID)).toBe(true);
    expect(defaultLaunchChain()).toBe(METIS_MAINNET_CHAIN_ID);
    expect(configuredLaunchChains()).toEqual([METIS_MAINNET_CHAIN_ID]);
    expect(launchClosedReason(METIS_MAINNET_CHAIN_ID)).toBeNull();
  });
});
