import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
} from "viem";
import { metisSepolia } from "./config";
import { policyVaultAbi } from "./abis";
import type { VaultStateView } from "@/lib/deputy/chain";

const client = createPublicClient({ chain: metisSepolia, transport: http() });

const STATES = ["created", "funded", "active", "paused", "revoked"] as const;

const decimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

interface PolicyView {
  budgetCeiling: bigint;
  perTransactionCap: bigint;
  dailyVelocityCap: bigint;
  duration: bigint;
  paymentToken: Address;
}

/**
 * Read a vault's live state directly from the client (public RPC, no key) — used
 * to render the founder's OWN vault after they create it, so the app shows the
 * Deputy they made rather than the seeded demo one. Shape matches the server's
 * VaultStateView so it drops straight into the app. Null on any read failure.
 */
export async function readVaultState(
  address: Address,
): Promise<VaultStateView | null> {
  try {
    const vault = getAddress(address);
    const [stateRaw, stats, owner, policy] = await Promise.all([
      client.readContract({ address: vault, abi: policyVaultAbi, functionName: "getState" }) as Promise<number>,
      client.readContract({ address: vault, abi: policyVaultAbi, functionName: "getSpendStats" }) as Promise<readonly [bigint, bigint, bigint]>,
      client.readContract({ address: vault, abi: policyVaultAbi, functionName: "getOwner" }) as Promise<Address>,
      client.readContract({ address: vault, abi: policyVaultAbi, functionName: "getPolicy" }) as Promise<PolicyView>,
    ]);
    const decimals = Number(
      await client.readContract({
        address: policy.paymentToken,
        abi: decimalsAbi,
        functionName: "decimals",
      }),
    );
    const [totalSpent, budgetRemaining] = stats;
    const toNum = (v: bigint) => Number(formatUnits(v, decimals));

    return {
      address: vault,
      budget: toNum(policy.budgetCeiling),
      spent: toNum(totalSpent),
      remaining: toNum(budgetRemaining),
      perTxCap: toNum(policy.perTransactionCap),
      velocityCap: toNum(policy.dailyVelocityCap),
      status: STATES[stateRaw] ?? "created",
      owner,
      raw: {
        budget: policy.budgetCeiling.toString(),
        spent: totalSpent.toString(),
        remaining: budgetRemaining.toString(),
        decimals,
      },
      chainId: 59902,
      network: "metis-sepolia",
      explorerUrl: `${metisSepolia.blockExplorers.default.url}/address/${vault}`,
    };
  } catch {
    return null;
  }
}
