import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { starknetAddresses, starknetConfig, starknetConfigured } from "./config";

const VARS = [
  "STARKNET_RPC_URL",
  "STARKNET_CLAIMS_ADDRESS",
  "STARKNET_ACCOUNT_ADDRESS",
  "STARKNET_PRIVATE_KEY",
  "STARKNET_USDC_ADDRESS",
] as const;

/** Circle's NATIVE USDC on Starknet — Cairo 1, 6 decimals. */
const NATIVE_USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
/** The OLDER StarkGate-bridged "USD Coin". Also real, also USDC, also 6 decimals — different token. */
const BRIDGED_USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const ADDR = NATIVE_USDC;

function set(over: Partial<Record<(typeof VARS)[number], string>> = {}): void {
  process.env.STARKNET_RPC_URL = "https://rpc.example";
  process.env.STARKNET_CLAIMS_ADDRESS = ADDR;
  process.env.STARKNET_ACCOUNT_ADDRESS = "0x01";
  process.env.STARKNET_PRIVATE_KEY = "0xdeadbeef";
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
}

beforeEach(() => {
  for (const v of VARS) delete process.env[v];
});
afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe("starknet configuration", () => {
  it("is absent until every part is present", () => {
    expect(starknetConfig()).toBeNull();
    set();
    expect(starknetConfig()).not.toBeNull();
  });

  /**
   * All-or-nothing, for the reason an LLM lane is: a partial configuration would sign with one
   * deployment's key against another's contract, and the failure would land on a worker's payout
   * rather than at startup.
   */
  it.each(VARS.filter((v) => v !== "STARKNET_USDC_ADDRESS"))(
    "is absent when %s alone is missing",
    (missing) => {
      set();
      delete process.env[missing];
      expect(starknetConfig()).toBeNull();
    },
  );

  /**
   * Two USDC tokens exist on Starknet and both are real: Circle's native Cairo 1 token, and the
   * older StarkGate-bridged one. Same name, same 6 decimals, different balances. Defaulting to the
   * wrong one reverts at transfer_from with an empty-balance error that says nothing about the
   * cause — which is exactly how it was found, after a funding transfer that had SUCCEEDED.
   */
  it("defaults to NATIVE USDC, not the bridged token", () => {
    set();
    expect(starknetConfig()?.tokenAddress).toBe(NATIVE_USDC);
    expect(starknetConfig()?.tokenAddress).not.toBe(BRIDGED_USDC);
  });

  it("accepts an explicit token override", () => {
    set({ STARKNET_USDC_ADDRESS: "0x0abc" });
    expect(starknetConfig()?.tokenAddress).toBe("0x0abc");
  });

  it("treats blank as missing, not as a value", () => {
    set({ STARKNET_CLAIMS_ADDRESS: "   " });
    expect(starknetConfig()).toBeNull();
  });

  /**
   * Presence is optional, shape is not. A truncated or mistyped address would otherwise become a
   * perfectly valid call to the wrong contract — money sent somewhere real and unrecoverable.
   */
  it("hard-fails on a malformed address instead of coercing it", () => {
    set({ STARKNET_CLAIMS_ADDRESS: "not-an-address" });
    expect(() => starknetConfig()).toThrow(/STARKNET_CLAIMS_ADDRESS is not a Starknet address/);

    set({ STARKNET_ACCOUNT_ADDRESS: "0xnothex" });
    expect(() => starknetConfig()).toThrow(/STARKNET_ACCOUNT_ADDRESS/);

    set({ STARKNET_PRIVATE_KEY: "hunter2" });
    expect(() => starknetConfig()).toThrow(/STARKNET_PRIVATE_KEY is not a felt/);
  });

  it("reports malformed as NOT configured rather than letting the throw escape a status check", () => {
    set({ STARKNET_CLAIMS_ADDRESS: "not-an-address" });
    expect(starknetConfigured()).toBe(false);
    set();
    expect(starknetConfigured()).toBe(true);
  });
});

describe("public addresses, without the signing key", () => {
  /**
   * A claim page needs a contract to name, not a credential. Tying the two together would mean a
   * page cannot render because a secret is absent — and the public claim door is the one most of
   * Sage's recipients can actually use.
   */
  it("resolves with no private key present", () => {
    process.env.STARKNET_CLAIMS_ADDRESS = ADDR;
    expect(starknetConfig()).toBeNull(); // signing is not configured...
    expect(starknetAddresses()).toMatchObject({ claims: ADDR, token: NATIVE_USDC }); // ...but reading is
  });

  it("is null when no contract is configured", () => {
    expect(starknetAddresses()).toBeNull();
  });

  it("carries an RPC so a read needs no further configuration", () => {
    process.env.STARKNET_CLAIMS_ADDRESS = ADDR;
    expect(starknetAddresses()?.rpcUrl).toMatch(/^https:\/\//);
    process.env.STARKNET_RPC_URL = "https://example.test";
    expect(starknetAddresses()?.rpcUrl).toBe("https://example.test");
  });

  it("refuses a malformed address rather than naming the wrong contract", () => {
    process.env.STARKNET_CLAIMS_ADDRESS = "not-an-address";
    expect(starknetAddresses()).toBeNull();
  });
});
