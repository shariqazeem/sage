import { afterEach, describe, expect, it, vi } from "vitest";
import { ERC8004, ERC8004_METIS, getAgentIdentities, getMetisAgentIdentity } from "./identity";
import { chainConfig, METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * SAGE'S IDENTITY ON METIS (19 Oct 2026). The canonical ERC-8004 registry is deployed on Andromeda
 * at the same address as on GOAT (verified on chain). Metis's identity is its own env, so a GOAT
 * registration can never be presented as a Metis one, and nothing is shown as registered until
 * the registration script has written it.
 */
afterEach(() => vi.unstubAllEnvs());

describe("the Metis identity", () => {
  it("is the same registry, on Metis, read from its own env", () => {
    expect(ERC8004_METIS.registry).toBe(ERC8004.registry);
    expect(ERC8004_METIS.chainId).toBe(METIS_MAINNET_CHAIN_ID);
    expect(ERC8004_METIS.network).toBe(chainConfig(METIS_MAINNET_CHAIN_ID).name);
  });

  it("is pending until registered, and a GOAT registration never stands in for it", () => {
    vi.stubEnv("ERC8004_AGENT_ID", "123");
    vi.stubEnv("ERC8004_AGENT_ADDRESS", "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
    vi.stubEnv("ERC8004_METIS_AGENT_ID", "");
    vi.stubEnv("ERC8004_METIS_AGENT_ADDRESS", "");
    const [goat, metis] = getAgentIdentities();
    expect(goat.registered).toBe(true);
    expect(metis.registered).toBe(false);
    expect(metis.agentId).toBeNull();
  });

  it("registered on Metis, it says so with its own id", () => {
    vi.stubEnv("ERC8004_METIS_AGENT_ID", "7");
    vi.stubEnv("ERC8004_METIS_AGENT_ADDRESS", "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
    expect(getMetisAgentIdentity()).toMatchObject({ registered: true, agentId: "7", chainId: 1088 });
  });
});
