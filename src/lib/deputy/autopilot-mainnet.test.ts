import { describe, expect, it } from "vitest";

import { autopilotGate } from "./autopilot";
import { CHAINS, GOAT_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY } from "./networks";

/**
 * THE MAINNET GATE MUST COVER EVERY CHAIN THAT MOVES REAL MONEY.
 *
 * The documented invariant is "mainnet auto-pay is gated by DEPUTY_AUTOPILOT_MAINNET". It was
 * written when GOAT was the only mainnet, and encoded as a literal chain id — so adding a second
 * real-money chain silently created a rail on which real USDC auto-pays with the gate switched
 * off. The registry already knows which chains are real; the gate has to ask it rather than
 * carry its own list, or the next chain added reopens exactly this hole.
 */

const passing = (chainId: number, mainnetAutopilotEnabled: boolean) => ({
  autonomy: "autopilot",
  status: "pending",
  engine: "llm" as const,
  recommendation: "pay" as const,
  confidence: 0.99,
  threshold: 0.85,
  hasHighFraud: false,
  chainId,
  mainnetAutopilotEnabled,
});

describe("the mainnet autopilot gate", () => {
  it("holds real money on EVERY mainnet when the switch is off", () => {
    const mainnets = Object.values(CHAINS).filter((c) => c.isMainnet);
    expect(mainnets.length).toBeGreaterThan(1); // otherwise this test proves nothing
    for (const chain of mainnets) {
      const verdict = autopilotGate(passing(chain.chainId, false));
      expect(verdict.pay, `${chain.name} auto-paid with mainnet autopilot OFF`).toBe(false);
      expect(verdict.reason).toMatch(/mainnet autopilot is off/i);
    }
  });

  it("pays on every mainnet once the switch is on", () => {
    for (const chain of Object.values(CHAINS).filter((c) => c.isMainnet)) {
      expect(autopilotGate(passing(chain.chainId, true)).pay).toBe(true);
    }
  });

  it("names Starknet explicitly, since that is the rail the literal id missed", () => {
    expect(autopilotGate(passing(STARKNET_MAINNET_KEY, false)).pay).toBe(false);
    expect(autopilotGate(passing(STARKNET_MAINNET_KEY, true)).pay).toBe(true);
  });

  it("leaves GOAT behaving exactly as before", () => {
    expect(autopilotGate(passing(GOAT_MAINNET_CHAIN_ID, false)).pay).toBe(false);
    expect(autopilotGate(passing(GOAT_MAINNET_CHAIN_ID, true)).pay).toBe(true);
  });

  it("leaves testnet autopilot unaffected, switch or no switch", () => {
    for (const chain of Object.values(CHAINS).filter((c) => !c.isMainnet)) {
      expect(autopilotGate(passing(chain.chainId, false)).pay).toBe(true);
    }
  });

  it("treats an unknown chain as real money rather than as a testnet", () => {
    // An id the registry does not know could be anything; assuming it is play money is the
    // failure that costs someone else's USDC.
    expect(autopilotGate(passing(424242, false)).pay).toBe(false);
  });

  it("still enforces every other condition on a mainnet with the switch on", () => {
    const base = passing(STARKNET_MAINNET_KEY, true);
    expect(autopilotGate({ ...base, engine: "heuristic" }).pay).toBe(false);
    expect(autopilotGate({ ...base, hasHighFraud: true }).pay).toBe(false);
    expect(autopilotGate({ ...base, confidence: 0.5 }).pay).toBe(false);
    expect(autopilotGate({ ...base, recommendation: "hold" }).pay).toBe(false);
    expect(autopilotGate({ ...base, autonomy: "manual" }).pay).toBe(false);
  });
});
