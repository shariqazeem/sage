import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  CHAINS,
  chainConfig,
  GOAT_MAINNET_CHAIN_ID,
  METIS_MAINNET_CHAIN_ID,
  METIS_SEPOLIA_CHAIN_ID,
  networkTier,
  PRIMARY_NETWORKS,
  railEnvPrefix,
  SECONDARY_NETWORKS,
  STARKNET_MAINNET_KEY,
} from "./networks";
import { LAUNCH_ENABLED_CHAINS, launchChainConfig } from "@/lib/launch/deployment-service";
import { minLaunchGasWei, operatorGasFloorWei } from "@/lib/treasury/gas-policy";
import { tokenLabel } from "@/lib/format";

/**
 * METIS MAINNET (Andromeda, 1088), A PRIMARY RAIL FROM 19 OCT 2026 (Sage the company).
 *
 * The defect this file exists for: before 19 Oct, `railEnvPrefix(1088)` fell through to "METIS", the
 * RETIRED Sepolia testnet's prefix. A job on Metis mainnet would have read the testnet factory address
 * and the testnet operator key (both still set on prod). Mainnet and testnet must never share a setting.
 */
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

afterEach(() => vi.unstubAllEnvs());

describe("Metis mainnet in the registry", () => {
  it("is a real-money EVM rail: m.USDC (6 dp), METIS gas, legacy pricing", () => {
    const c = chainConfig(METIS_MAINNET_CHAIN_ID);
    expect(c.chainId).toBe(1088);
    expect(c.isMainnet).toBe(true);
    expect(c.evm).toBe(true);
    expect(c.usdcAddress).toBe("0xEA32A96608495e54156Ae48931A7c20f0dcc1a21"); // read on chain 19 Oct: m.USDC, 6 dp
    expect(c.nativeSymbol).toBe("METIS");
    expect(c.gas).toBe("legacy"); // no baseFeePerGas in Andromeda blocks
    expect(c.name).toBe("Metis");
    expect(tokenLabel(METIS_MAINNET_CHAIN_ID)).toBe("USDC");
  });

  it("reads its OWN deploy-time settings, never the retired Sepolia testnet's", () => {
    expect(railEnvPrefix(METIS_MAINNET_CHAIN_ID)).toBe("METIS_MAINNET");
    expect(railEnvPrefix(METIS_SEPOLIA_CHAIN_ID)).toBe("METIS");
    expect(railEnvPrefix(METIS_MAINNET_CHAIN_ID)).not.toBe(railEnvPrefix(METIS_SEPOLIA_CHAIN_ID));
  });

  it("is not launchable on the testnet's settings alone (fails closed), and is with its own", () => {
    vi.stubEnv("METIS_CAMPAIGN_FACTORY_ADDRESS", "0x2249b773aFEd5594985F7D350581A1b55f279C7f"); // prod's Sepolia factory
    vi.stubEnv("NEXT_PUBLIC_OPERATOR_ADDRESS", "0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35"); // prod's Sepolia operator
    vi.stubEnv("CAMPAIGN_VAULT_FACTORY_ADDRESS", "0x2249b773aFEd5594985F7D350581A1b55f279C7f");
    vi.stubEnv("METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS", "");
    vi.stubEnv("METIS_MAINNET_OPERATOR_ADDRESS", "");
    const bare = launchChainConfig(METIS_MAINNET_CHAIN_ID);
    expect(bare.configured).toBe(false);
    expect(bare.factory).toBeNull(); // never the Sepolia factory, never the generic one

    vi.stubEnv("METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS", "0x00000000000000000000000000000000000000aa");
    vi.stubEnv("METIS_MAINNET_OPERATOR_ADDRESS", "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
    const own = launchChainConfig(METIS_MAINNET_CHAIN_ID);
    expect(own.configured).toBe(true);
    expect(own.factory?.toLowerCase()).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("the frozen settlement files resolve Metis mainnet by its own names (and only them)", () => {
    const vault = src("campaign-vault.ts");
    expect(vault).toContain("METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS");
    // the Metis-mainnet branch returns before the generic fallback is ever read
    const branch = vault.slice(vault.indexOf("chainId === METIS_MAINNET_CHAIN_ID"), vault.indexOf("const raw ="));
    expect(branch).not.toContain("CAMPAIGN_VAULT_FACTORY_ADDRESS ??");
    const signer = src("signer.ts");
    const keyBranch = signer.slice(signer.indexOf("id === METIS_MAINNET_CHAIN_ID"), signer.indexOf("chainConfig(chainId).chainId === 2345"));
    expect(keyBranch).toContain("METIS_MAINNET_OPERATOR_PRIVATE_KEY");
    expect(keyBranch).not.toContain('"OPERATOR_PRIVATE_KEY"'); // the Sepolia key is never a mainnet key
  });
});

describe("gas on Metis is sized for METIS, not BTC", () => {
  it("a launch needs about twice the measured ~1.9M gas at ~13.4 gwei", () => {
    const measured = BigInt(1_900_000) * BigInt(13_400_000_000); // ≈ 0.0255 METIS
    expect(minLaunchGasWei(METIS_MAINNET_CHAIN_ID)).toBeGreaterThan(measured);
    expect(minLaunchGasWei(METIS_MAINNET_CHAIN_ID)).toBe(BigInt("50000000000000000")); // 0.05 METIS
  });

  it("GOAT's BTC-sized floor is unchanged, and the operator keeps a METIS reserve for payouts", () => {
    expect(minLaunchGasWei(GOAT_MAINNET_CHAIN_ID)).toBe(BigInt("3000000000000"));
    expect(operatorGasFloorWei(METIS_MAINNET_CHAIN_ID)).toBe(BigInt("200000000000000000")); // 0.2 METIS ≈ 100 payouts
  });
});

describe("the network policy (26 Oct 2026: one network, Metis; GOAT paused; Arc and Starknet closed)", () => {
  it("one primary network, Metis; GOAT the only secondary, paused; Arc and Starknet offered nowhere", () => {
    expect([...PRIMARY_NETWORKS]).toEqual([METIS_MAINNET_CHAIN_ID]);
    // GOAT stays in the policy so the accounts, jobs and receipts already there stay reachable
    expect([...SECONDARY_NETWORKS]).toEqual([GOAT_MAINNET_CHAIN_ID]);
    expect(SECONDARY_NETWORKS).not.toContain(ARC_MAINNET_CHAIN_ID);
    expect(SECONDARY_NETWORKS).not.toContain(STARKNET_MAINNET_KEY);
    expect(networkTier(METIS_MAINNET_CHAIN_ID)).toBe("primary");
    expect(networkTier(GOAT_MAINNET_CHAIN_ID)).toBe("secondary");
    // closed: offered by no surface, exactly like a retired testnet...
    expect(networkTier(ARC_MAINNET_CHAIN_ID)).toBe("retired");
    expect(networkTier(STARKNET_MAINNET_KEY)).toBe("retired");
    expect(networkTier(ARC_TESTNET_CHAIN_ID)).toBe("retired");
    expect(networkTier(METIS_SEPOLIA_CHAIN_ID)).toBe("retired");
    // ...but still real money in the registry, so what already happened there reads as what it was
    expect(chainConfig(ARC_MAINNET_CHAIN_ID).isMainnet).toBe(true);
    expect(chainConfig(STARKNET_MAINNET_KEY).isMainnet).toBe(true);
  });

  it("no testnet is primary or secondary, and every listed network is a real registry entry", () => {
    for (const id of [...PRIMARY_NETWORKS, ...SECONDARY_NETWORKS]) {
      expect(CHAINS[id], `chain ${id} in the registry`).toBeTruthy();
      expect(chainConfig(id).isMainnet).toBe(true);
    }
  });

  it("every EVM network Sage launches on is in the policy, and every primary EVM network is launchable", () => {
    for (const id of LAUNCH_ENABLED_CHAINS) expect(networkTier(id), `launch chain ${id}`).not.toBe("retired");
    for (const id of PRIMARY_NETWORKS) if (chainConfig(id).evm) expect(LAUNCH_ENABLED_CHAINS).toContain(id);
  });
});
