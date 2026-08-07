import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * STOP MUST BE IDEMPOTENT, because the chain and the catalogue can disagree.
 *
 * Measured live: vault 0x4D2F68…DBd2 sat REVOKED on-chain (getState 4) while its campaign read
 * "live" in the DB. revoke() reverted with "Execution reverted for an unknown reason" and the whole
 * stop died — including the withdraw that would have recovered any remaining funds and the
 * cataloguing that would have fixed the very disagreement causing the revert. The founder had
 * confirmed the stop twice and got an error twice, on a campaign that was in fact already stopped.
 *
 * So the flow now reads the chain first and does only what is left to do. These tests pin every
 * branch, most importantly the two skips: a revoke that is already done must not be sent again,
 * and a withdraw of zero must not be sent at all.
 */

const h = vi.hoisted(() => ({
  state: 1 as number | Error,
  balance: BigInt(0) as bigint | Error,
  execCalls: [] as string[],
  policyCreated: 0,
  policiesSet: 0,
  restored: 0,
  execFails: null as string | null,
}));

vi.mock("@/lib/deputy/chain", () => ({
  publicClient: () => ({
    readContract: async (req: { functionName: string }) => {
      const v = req.functionName === "getState" ? h.state : h.balance;
      if (v instanceof Error) throw v;
      return v;
    },
  }),
}));
vi.mock("./mandate", () => ({
  createStopCampaignPolicy: async () => {
    h.policyCreated += 1;
    return "pol_stop";
  },
}));
vi.mock("./client", () => ({
  setWalletPolicies: async () => {
    h.policiesSet += 1;
  },
}));
vi.mock("./withdraw", () => ({
  restoreBasePolicy: async () => {
    h.restored += 1;
  },
}));
vi.mock("./executor", () => ({
  executeViaPrivy: async (_id: string, _owner: string, req: { label: string }) => {
    h.execCalls.push(req.label);
    if (h.execFails === req.label) throw new Error(`${req.label} reverted`);
    return { txHash: `0x${req.label}`, explorerUrl: `https://x/${req.label}` };
  },
}));
vi.mock("@/lib/launch/deployment-service", () => ({
  launchChainConfig: () => ({
    factory: "0x1111111111111111111111111111111111111111",
    token: "0x2222222222222222222222222222222222222222",
    chainId: 2345,
  }),
}));

import { stopCampaignViaPrivy } from "./stop-campaign";
import type { AgentWallet } from "@/lib/db/schema";

const WALLET: AgentWallet = {
  chatId: "chat1",
  founderAddress: "0x3333333333333333333333333333333333333333",
  privyWalletId: "pw_1",
  privyWalletAddress: "0x3333333333333333333333333333333333333333",
  policyId: "pol_base",
  perCampaignCapBase: 2_000_000,
  chainId: 2345,
  createdAt: 1,
  updatedAt: 1,
} as AgentWallet;
const VAULT = "0x4D2F68E81aC3424EAba217b2ad3f69Efc0F5DBd2" as const;

const run = () => stopCampaignViaPrivy(WALLET, VAULT);

beforeEach(() => {
  h.state = 1;
  h.balance = BigInt(500_000);
  h.execCalls = [];
  h.policyCreated = 0;
  h.policiesSet = 0;
  h.restored = 0;
  h.execFails = null;
});

describe("stopCampaignViaPrivy is idempotent", () => {
  it("an active vault with funds gets the full sequence, as before", async () => {
    const r = await run();
    expect(h.execCalls).toEqual(["revoke", "withdrawRemaining"]);
    expect(r.alreadyRevoked).toBe(false);
    expect(r.revoke?.txHash).toBe("0xrevoke");
    expect(r.withdraw?.txHash).toBe("0xwithdrawRemaining");
    expect(r.recoveredBase).toBe(BigInt(500_000));
    expect(h.restored).toBe(1);
  });

  it("an ALREADY-REVOKED vault with funds skips the revoke and still recovers the money", async () => {
    // The half of the live failure that would have mattered with money inside: the revert on
    // revoke() must not cost the founder the withdraw.
    h.state = 4;
    const r = await run();
    expect(h.execCalls).toEqual(["withdrawRemaining"]);
    expect(r.alreadyRevoked).toBe(true);
    expect(r.revoke).toBeNull();
    expect(r.recoveredBase).toBe(BigInt(500_000));
    expect(h.restored).toBe(1);
  });

  it("an already-revoked, EMPTY vault touches nothing — no policy swap, no transactions", async () => {
    // The exact live case. There is nothing left to do on-chain; the only fix is the catalogue,
    // which is the caller's job.
    h.state = 4;
    h.balance = BigInt(0);
    const r = await run();
    expect(h.execCalls).toEqual([]);
    expect(h.policyCreated).toBe(0);
    expect(r).toEqual({ revoke: null, withdraw: null, alreadyRevoked: true, recoveredBase: BigInt(0) });
  });

  it("an active vault with zero balance revokes but never withdraws zero", async () => {
    h.balance = BigInt(0);
    const r = await run();
    expect(h.execCalls).toEqual(["revoke"]);
    expect(r.withdraw).toBeNull();
    expect(r.recoveredBase).toBe(BigInt(0));
  });

  it("an unreadable chain state degrades to the FULL sequence — never to doing less", async () => {
    // If the read fails we cannot know what is already done, and the safe direction is attempting
    // everything: a redundant revoke reverts loudly, a skipped withdraw strands money silently.
    h.state = new Error("rpc down");
    h.balance = new Error("rpc down");
    const r = await run();
    expect(h.execCalls).toEqual(["revoke", "withdrawRemaining"]);
    expect(r.alreadyRevoked).toBe(false);
    expect(r.recoveredBase).toBe(BigInt(0)); // unknown is reported as zero, never invented
  });

  it("the base mandate is ALWAYS restored, even when the withdraw throws", async () => {
    h.execFails = "withdrawRemaining";
    await expect(run()).rejects.toThrow("withdrawRemaining reverted");
    expect(h.restored).toBe(1);
  });
});
