import type { Abi } from "viem";
// Foundry build artifacts (contracts/out is gitignored — requires `forge build`).
// We consume only `.abi`; TS widens the JSON so we normalize the type once here.
import factoryArtifact from "../../../contracts/out/PolicyVaultFactory.sol/PolicyVaultFactory.json";
import mockUsdcArtifact from "../../../contracts/out/MockUSDC.sol/MockUSDC.json";
import vaultArtifact from "../../../contracts/out/PolicyVault.sol/PolicyVault.json";

export const factoryAbi = factoryArtifact.abi as unknown as Abi;
export const mockUsdcAbi = mockUsdcArtifact.abi as unknown as Abi;
export const policyVaultAbi = vaultArtifact.abi as unknown as Abi;
