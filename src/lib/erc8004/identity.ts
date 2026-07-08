/**
 * The Deputy's ERC-8004 on-chain identity (GOAT Network, chain 2345). The
 * registration constants are fixed; the agent's id + address are read from env
 * and written there by `scripts/register-erc8004.mjs` on a successful register.
 * Before registration the panel renders a truthful "pending" state — it never
 * fabricates an identity.
 */
export const ERC8004 = {
  registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  chainId: 2345,
  network: "GOAT Network",
  scanUrl: "https://8004scan.io/agents?chain=2345",
  explorer: "https://explorer.goat.network",
} as const;

export interface AgentIdentity {
  registered: boolean;
  name: string | null;
  agentId: string | null;
  address: string | null;
  registry: string;
  chainId: number;
  network: string;
  scanUrl: string;
  explorer: string;
}

/** Read the agent identity from env (server-side). Empty → "pending" state. */
export function getAgentIdentity(): AgentIdentity {
  const agentId = process.env.ERC8004_AGENT_ID || null;
  const address = process.env.ERC8004_AGENT_ADDRESS || null;
  const name = process.env.ERC8004_AGENT_NAME || (agentId ? "Sage" : null);
  return {
    registered: !!agentId && !!address,
    name,
    agentId,
    address,
    registry: ERC8004.registry,
    chainId: ERC8004.chainId,
    network: ERC8004.network,
    scanUrl: ERC8004.scanUrl,
    explorer: ERC8004.explorer,
  };
}
