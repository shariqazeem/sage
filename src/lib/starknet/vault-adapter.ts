import "server-only";

import { Contract, RpcProvider } from "starknet";
import type { Address, Hash } from "viem";

import type { ChainCampaignSnapshot } from "@/lib/campaigns/vault-agreement";
import { starknetAddresses, starknetVaultClassHash } from "./config";
import { decodeVaultStatus } from "./vault";
import { toFelt } from "./felt";
import ABI from "./vault-abi.json" assert { type: "json" };

/**
 * READING A STARKNET VAULT THE WAY THE EVM ONE IS READ.
 *
 * The V2 attach path — the one that wires a campaign's private corpus, verifies the vault agrees
 * with the database, and checks the public identity invariant — talks to a chain through exactly
 * one seam: `readSnapshot`. Implementing that seam is what lets the Starknet rail run the SAME
 * attach code as GOAT instead of a thinner copy of it.
 *
 * PROVENANCE IS THE CLASS HASH. On EVM a vault is trusted because a known factory made it; the
 * Universal Deployer vouches for nobody, so what proves a Starknet vault is Sage's is that its code
 * IS Sage's code. That is a stronger statement than factory membership — a factory can be asked to
 * make something unexpected, a class hash is the bytecode itself.
 *
 * NOTHING HERE IS INVENTED TO SATISFY A CHECK. Every field is read from the contract, including the
 * campaign id and mission plan digest the vault now records at deployment. Where an EVM concept has
 * no Starknet counterpart it is reported honestly rather than filled in: there is no guardian, so
 * it reads as the zero address, which the agreement check already treats as "no guardian" instead
 * of as a match.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

const hex = (v: unknown): string => `0x${BigInt(v as bigint).toString(16)}`;

export async function readStarknetSnapshot(
  vault: Address,
  chainId: number,
  missionIds: Hash[],
): Promise<ChainCampaignSnapshot> {
  const cfg = starknetAddresses();
  if (!cfg) throw new Error("starknet is not configured");
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });

  // The vault's own code must be the class Sage declared. Anything else is not a Sage vault,
  // whatever it answers to the getters below.
  const expectedClass = starknetVaultClassHash();
  // Without a declared class there is nothing to compare provenance against, and "cannot check"
  // must never read as "checked and fine".
  if (!expectedClass) throw new Error("STARKNET_VAULT_CLASS_HASH is not set");
  let actualClass: string;
  try {
    actualClass = await provider.getClassHashAt(vault, "latest");
  } catch {
    throw new Error("no contract at that address");
  }
  const factoryRecognizes = BigInt(actualClass) === BigInt(expectedClass);

  const c = new Contract({ abi: ABI, address: vault, providerOrAccount: provider });
  const [owner, operator, token, status, ceiling, campaignIdHash, missionPlanDigest] =
    await Promise.all([
      c.call("get_owner", []),
      c.call("get_operator", []),
      c.call("get_token", []),
      c.call("get_status", []),
      c.call("get_budget_ceiling", []),
      c.call("get_campaign_id_hash", []),
      c.call("get_mission_plan_digest", []),
    ]);

  const missions: ChainCampaignSnapshot["missions"] = {};
  for (const id of missionIds) {
    // ASKED BY THE KEY THE CHAIN WAS WRITTEN WITH. A mission id is a 256-bit keccak and the vault
    // keys it by the felt reduction, so querying the full hash finds nothing — and "nothing" reads
    // as `mission_missing`, which accuses a correctly funded vault of not holding the plan.
    // Recorded under the id the CALLER passed, so the agreement check can find it.
    try {
      const m = (await c.call("get_mission", [toFelt(id)])) as {
        exists?: boolean;
        reward?: bigint;
        max_completions?: bigint;
      };
      missions[id.toLowerCase()] = {
        exists: Boolean(m?.exists),
        rewardBase: BigInt(m?.reward ?? 0),
        maxCompletions: BigInt(m?.max_completions ?? 0),
      };
    } catch {
      // Unreadable is not "absent": absent would let the agreement check pass a mission the vault
      // cannot actually pay. Recorded as non-existent with zero terms, which the check refuses.
      missions[id.toLowerCase()] = { exists: false, rewardBase: BigInt(0), maxCompletions: BigInt(0) };
    }
  }

  const statusN = decodeVaultStatus(status);
  return {
    factoryRecognizes,
    owner: hex(owner),
    operator: hex(operator),
    // No guardian exists in the Cairo vault. Zero is what "no guardian" means to the check —
    // it is not a placeholder standing in for one.
    guardian: ZERO,
    token: hex(token),
    campaignIdHash: hex(campaignIdHash),
    missionPlanDigest: hex(missionPlanDigest),
    budgetCeiling: BigInt(ceiling as bigint),
    chainId,
    state: statusN === 1 ? "active" : statusN === 2 ? "revoked" : "paused",
    // The Cairo vault refuses a reused intent hash — the same guarantee, in the contract itself.
    replaySupport: "supported",
    missions,
  };
}
