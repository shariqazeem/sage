import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { readFacilitatorConfig } from "./config";
import { M_USDC, M_USDT, METIS_DEFAULT_RPC, PROXY_BUILDS } from "./constants";
import { FACILITATOR_KEY, OTHER_KEY } from "./testing";

const full = {
  X402_METIS_ENABLED: "1",
  X402_METIS_FACILITATOR_PRIVATE_KEY: FACILITATOR_KEY,
  X402_METIS_PERMIT2_PROXY_ADDRESS: PROXY_BUILDS.paris.address.toLowerCase(),
};

describe("the env gate: off unless every piece is set", () => {
  it("is 404 with nothing set, and with the switch at anything but 1", () => {
    expect(readFacilitatorConfig({})).toMatchObject({ open: false, status: 404 });
    expect(readFacilitatorConfig({ ...full, X402_METIS_ENABLED: "0" })).toMatchObject({ open: false, status: 404 });
    expect(readFacilitatorConfig({ ...full, X402_METIS_ENABLED: "true" })).toMatchObject({ open: false, status: 404 });
  });

  it("is 503 naming what is missing when switched on half-configured", () => {
    const gate = readFacilitatorConfig({ X402_METIS_ENABLED: "1" });
    expect(gate.open).toBe(false);
    if (gate.open) return;
    expect(gate.status).toBe(503);
    expect(gate.message).toContain("X402_METIS_FACILITATOR_PRIVATE_KEY is not set");
    expect(gate.message).toContain("X402_METIS_PERMIT2_PROXY_ADDRESS is not set");
  });

  it("never repeats a malformed key back", () => {
    const bad = "0xnot-a-key-but-maybe-a-secret-0123456789";
    const gate = readFacilitatorConfig({ ...full, X402_METIS_FACILITATOR_PRIVATE_KEY: bad });
    expect(gate).toMatchObject({ open: false, status: 503 });
    expect(JSON.stringify(gate)).not.toContain("maybe-a-secret");
  });

  it("refuses a key Sage already signs payouts with: one key is one nonce sequence", () => {
    const gate = readFacilitatorConfig({ ...full, GOAT_AGENT_PRIVATE_KEY: FACILITATOR_KEY.slice(2).toUpperCase() });
    expect(gate).toMatchObject({ open: false, status: 503 });
    expect(JSON.stringify(gate)).not.toContain(FACILITATOR_KEY.slice(2));
    expect(readFacilitatorConfig({ ...full, GOAT_AGENT_PRIVATE_KEY: OTHER_KEY }).open).toBe(true);
  });

  it("refuses a malformed proxy address, allowlist entry or cap", () => {
    expect(readFacilitatorConfig({ ...full, X402_METIS_PERMIT2_PROXY_ADDRESS: "0x1234" }).open).toBe(false);
    expect(readFacilitatorConfig({ ...full, X402_METIS_PAY_TO_ALLOWLIST: `${PROXY_BUILDS.paris.address},nope` }).open).toBe(false);
    expect(readFacilitatorConfig({ ...full, X402_METIS_DAILY_SETTLE_CAP: "-3" }).open).toBe(false);
    expect(readFacilitatorConfig({ ...full, METIS_MAINNET_RPC_URL: "ftp://x" }).open).toBe(false);
  });

  it("opens when complete, holding an account and never the key itself", () => {
    const gate = readFacilitatorConfig(full);
    expect(gate.open).toBe(true);
    if (!gate.open) return;
    const { config } = gate;
    expect(config.account.address).toBe(privateKeyToAccount(FACILITATOR_KEY).address);
    expect(config.proxy).toBe(PROXY_BUILDS.paris.address);
    expect(config.rpcUrl).toBe(METIS_DEFAULT_RPC);
    expect(config.assets).toEqual([M_USDC.address]);
    expect(config.payToAllowlist).toEqual([]); // no payee for Sage yet: settles for nobody
    expect(config.dailySettleCap).toBe(500);
    expect(JSON.stringify(config)).not.toContain(FACILITATOR_KEY.slice(2));
  });

  it("takes the optional settings", () => {
    const gate = readFacilitatorConfig({
      ...full,
      X402_METIS_ACCEPT_USDT: "1",
      X402_METIS_PAY_TO_ALLOWLIST: ` ${PROXY_BUILDS.canonical.address.toLowerCase()} , ${M_USDC.address} `,
      X402_METIS_DAILY_SETTLE_CAP: "40",
      METIS_MAINNET_RPC_URL: "https://metis-rpc.publicnode.com",
    });
    expect(gate.open).toBe(true);
    if (!gate.open) return;
    expect(gate.config.assets).toEqual([M_USDC.address, M_USDT.address]);
    expect(gate.config.payToAllowlist).toEqual([PROXY_BUILDS.canonical.address, M_USDC.address]);
    expect(gate.config.dailySettleCap).toBe(40);
    expect(gate.config.rpcUrl).toBe("https://metis-rpc.publicnode.com");
  });

  it("settles only Sage's own sales unless the allowlist says otherwise", () => {
    const sage = PROXY_BUILDS.canonical.address; // any checksummed address will do as Sage's payee
    const allow = (env: Record<string, string>) => {
      const gate = readFacilitatorConfig({ ...full, ...env });
      return gate.open ? gate.config.payToAllowlist : "closed";
    };
    expect(allow({ SAGE_BILLING_ADDRESS: sage.toLowerCase() })).toEqual([sage]);
    expect(allow({ X402_METIS_PAY_TO: sage, SAGE_BILLING_ADDRESS: M_USDC.address })).toEqual([sage]);
    expect(allow({ SAGE_BILLING_ADDRESS: sage, X402_METIS_PAY_TO_ALLOWLIST: M_USDC.address })).toEqual([M_USDC.address]);
    expect(allow({ SAGE_BILLING_ADDRESS: sage, X402_METIS_PAY_TO_ALLOWLIST: "*" })).toBeNull();
  });
});
