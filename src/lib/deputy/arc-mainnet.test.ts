import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, ARC_USDC, CHAINS, chainConfig, isArcChain, railEnvPrefix } from "./networks";
import { LAUNCH_ENABLED_CHAINS } from "@/lib/launch/deployment-service";
import { tokenLabel, tokenSymbol } from "@/lib/format";
import { exitPicture } from "@/lib/money/exit";

/**
 * ARC MAINNET, AS A RAIL. Registered 26 Sep 2026: chain 5042, the same USDC contract and precision as
 * the testnet (read by eth_call), USDC as the gas. Every Arc-specific branch used to test
 * `=== 5042002`; each now asks `isArcChain`, so mainnet inherits what the testnet proved.
 */
describe("Arc mainnet in the registry", () => {
  it("is a real-money EVM rail whose gas is USDC", () => {
    const c = chainConfig(ARC_MAINNET_CHAIN_ID);
    expect(c.chainId).toBe(5042);
    expect(c.isMainnet).toBe(true);
    expect(c.evm).toBe(true);
    expect(c.usdcAddress).toBe(ARC_USDC);
    expect(c.nativeSymbol).toBe("USDC");
    expect(c.explorerUrl).toBe("https://explorer.arc.io");
    expect(CHAINS[ARC_TESTNET_CHAIN_ID].usdcAddress).toBe(ARC_USDC);
  });

  it("is Arc to every Arc branch, and nothing else is", () => {
    expect(isArcChain(ARC_MAINNET_CHAIN_ID)).toBe(true);
    expect(isArcChain(ARC_TESTNET_CHAIN_ID)).toBe(true);
    for (const other of [2345, 59902, 1088, 900_001, null, undefined]) expect(isArcChain(other)).toBe(false);
  });

  it("reads its own deploy-time env, never the testnet's", () => {
    expect(railEnvPrefix(ARC_MAINNET_CHAIN_ID)).toBe("ARC_MAINNET");
    expect(railEnvPrefix(ARC_TESTNET_CHAIN_ID)).toBe("ARC");
    expect(railEnvPrefix(2345)).toBe("GOAT");
    expect(railEnvPrefix(59902)).toBe("METIS");
  });

  it("names its money as USDC, and the testnet's as test USDC", () => {
    expect(tokenSymbol(ARC_MAINNET_CHAIN_ID)).toBe("USDC");
    expect(tokenLabel(ARC_MAINNET_CHAIN_ID)).toBe("USDC");
    expect(tokenLabel(ARC_TESTNET_CHAIN_ID)).toBe("test USDC");
  });

  it("tells a worker the truth about cashing out: real money, one extra hop", () => {
    const p = exitPicture(BigInt(1_000_000), ARC_MAINNET_CHAIN_ID);
    expect(p.asset).toBe("USDC");
    expect(p.liquidity).toBe("limited");
    expect(p.constrained).toBe(true);
  });
});

/**
 * TWO LISTS THAT DRIFT: the launch allowlist and the frozen settlement files. A chain the wizard can
 * deploy to must also be a chain the vault adapter can resolve a factory for and the signer can load a
 * key for — or a campaign launches and then cannot be settled. Read the frozen sources, not a copy.
 */
describe("every launch chain is known to the settlement files", () => {
  const src = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const vault = src("campaign-vault.ts");
  const signer = src("signer.ts");

  it("resolves a factory for every EVM launch chain", () => {
    for (const id of LAUNCH_ENABLED_CHAINS) {
      const prefix = railEnvPrefix(id);
      expect(vault, `campaign-vault.ts must read ${prefix}_CAMPAIGN_FACTORY_ADDRESS`).toContain(`${prefix}_CAMPAIGN_FACTORY_ADDRESS`);
    }
  });

  it("loads the Arc operator for both Arc networks", () => {
    expect(signer).toContain("isArcChain(id)");
    expect(signer).toContain("_OPERATOR_PRIVATE_KEY");
  });
});
