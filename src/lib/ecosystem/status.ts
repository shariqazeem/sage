import "server-only";

import { getEnv } from "@/lib/env";
import { getAgentIdentity } from "@/lib/erc8004/identity";
import { getCampaign, listAllDecisions, FLAGSHIP_CAMPAIGN_ID } from "@/lib/db/campaigns";
import { networkLabel, tokenSymbol, isTestnetChain } from "@/lib/format";
import { publicClient } from "@/lib/deputy/chain";

export type ClawupState = "not_configured" | "configured" | "live";
export type Erc8004State = "not_configured" | "claimed" | "verified";
export type X402State = "not_configured" | "configured" | "paid";

export interface EcosystemStatus {
  clawup: { state: ClawupState; note: string };
  erc8004: {
    state: Erc8004State;
    agentId: string | null;
    wallet: string | null;
    registry: string;
    chainId: number;
    network: string;
    scanUrl: string;
    explorerUrl: string;
  };
  x402: { state: X402State; realPayments: number; merchant: string | null };
  campaignExecution: { network: string; token: string; chainId: number; isTestnet: boolean } | null;
  mainnetAutopilot: { enabled: boolean };
}

/* Cache the on-chain ERC-8004 ownerOf verification — a REAL read, not env presence. */
let ercCache: { at: number; verified: boolean } | null = null;
const OWNER_OF_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

async function verifyErc8004OnChain(
  agentId: string,
  wallet: string,
  registry: string,
  chainId: number,
): Promise<boolean> {
  if (ercCache && Date.now() - ercCache.at < 600_000) return ercCache.verified;
  try {
    const owner = (await publicClient(chainId).readContract({
      address: registry as `0x${string}`,
      abi: OWNER_OF_ABI,
      functionName: "ownerOf",
      args: [BigInt(agentId)],
    })) as string;
    const verified = owner.toLowerCase() === wallet.toLowerCase();
    ercCache = { at: Date.now(), verified };
    return verified;
  } catch {
    return false; // unreadable chain → honest: "claimed", never "verified"
  }
}

/**
 * The ONE canonical ecosystem-status model — consumed by the landing strip, the agent page,
 * the README, and demo docs so no two surfaces disagree. Every "live / verified / paid" is
 * backed by REAL evidence (an on-chain ownerOf match, a settled x402 tx in the journal, the
 * flagship campaign's actual network), NEVER by environment-variable presence alone. It fails
 * closed: unknown or unreadable → the lower state.
 */
export async function ecosystemStatus(): Promise<EcosystemStatus> {
  const e = getEnv();
  const id = getAgentIdentity();

  // ClawUp: "configured" when the agent API key is set; "live" ONLY with an explicit,
  // human-set CLAWUP_LIVE flag (key presence is never enough to claim a working install).
  const clawup: EcosystemStatus["clawup"] = e.SAGE_AGENT_API_KEY
    ? e.CLAWUP_LIVE === "true"
      ? { state: "live", note: "Sage agent verified live on ClawUp." }
      : { state: "configured", note: "Agent API configured; ClawUp install pending verification." }
    : { state: "not_configured", note: "Agent API not configured." };

  // ERC-8004: "verified" only if the registry's ownerOf matches the claimed wallet on-chain.
  let ercState: Erc8004State = "not_configured";
  if (id.agentId && id.address) {
    ercState = (await verifyErc8004OnChain(id.agentId, id.address, id.registry, id.chainId))
      ? "verified"
      : "claimed";
  }

  // x402: "paid" only if a real settled x402 payment tx exists in the decision journal.
  const realPayments = listAllDecisions().filter((d) => !!d.x402PaymentTx).length;
  const x402State: X402State =
    realPayments > 0 ? "paid" : e.GOATX402_MERCHANT_ID ? "configured" : "not_configured";

  // Campaign execution: the REAL network + token of the flagship campaign.
  const flagship = getCampaign(FLAGSHIP_CAMPAIGN_ID);
  const campaignExecution = flagship
    ? {
        network: networkLabel(flagship.chainId),
        token: tokenSymbol(flagship.chainId),
        chainId: flagship.chainId,
        isTestnet: isTestnetChain(flagship.chainId),
      }
    : null;

  return {
    clawup,
    erc8004: {
      state: ercState,
      agentId: id.agentId,
      wallet: id.address,
      registry: id.registry,
      chainId: id.chainId,
      network: id.network,
      scanUrl: id.scanUrl,
      explorerUrl: id.explorer,
    },
    x402: { state: x402State, realPayments, merchant: e.GOATX402_MERCHANT_ID ?? null },
    campaignExecution,
    mainnetAutopilot: { enabled: e.DEPUTY_AUTOPILOT_MAINNET?.toLowerCase() === "true" },
  };
}
