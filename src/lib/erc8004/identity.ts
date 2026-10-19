/**
 * Sage's ERC-8004 on-chain identity. It was registered on GOAT Network (chain 2345) first; the same
 * canonical registry is deployed on Metis (chain 1088, verified on chain 19 Oct 2026: same address,
 * owner and implementation as on Ethereum, Base and GOAT), and Metis Rise asks that an agent's
 * Metis wallet be the same address as its identity elsewhere. Sage's Metis operator is that address.
 *
 * The registration constants are fixed; each network's agent id + address are read from env and
 * written there by `scripts/register-erc8004.mjs [--chain metis]`. Before registration a network
 * renders a truthful "pending" state; nothing here ever fabricates an identity.
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

/** The same canonical registry, on Metis. Registration there is written to the ERC8004_METIS_* env. */
export const ERC8004_METIS = {
  registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  chainId: 1088,
  network: "Metis",
  scanUrl: "https://andromeda-explorer.metis.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  explorer: "https://andromeda-explorer.metis.io",
} as const;

/** Sage's identity on Metis, or a pending one. Same rules as on GOAT: read from env, never guessed. */
export function getMetisAgentIdentity(): AgentIdentity {
  const agentId = process.env.ERC8004_METIS_AGENT_ID || null;
  const address = process.env.ERC8004_METIS_AGENT_ADDRESS || null;
  return {
    registered: !!agentId && !!address,
    name: process.env.ERC8004_METIS_AGENT_NAME || (agentId ? "Sage" : null),
    agentId,
    address,
    registry: ERC8004_METIS.registry,
    chainId: ERC8004_METIS.chainId,
    network: ERC8004_METIS.network,
    scanUrl: ERC8004_METIS.scanUrl,
    explorer: ERC8004_METIS.explorer,
  };
}

/** Every network Sage is (or will be) registered on, GOAT first. */
export function getAgentIdentities(): AgentIdentity[] {
  return [getAgentIdentity(), getMetisAgentIdentity()];
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
