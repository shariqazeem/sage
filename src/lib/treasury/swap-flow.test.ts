import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";

/**
 * THE WHOLE SWAP, with Privy and the chain stubbed: the permit goes on, exactly the two calls the
 * founder confirmed are signed (approve the router, then swap back to the account), the wallet is
 * re-locked, and the move is recorded with what the pool's own event says moved.
 */
const h = vi.hoisted(() => ({
  policies: [] as Array<Record<string, unknown>>,
  attached: [] as string[][],
  calls: [] as Array<{ to: string; data: string; value?: bigint; label?: string }>,
  recorded: [] as Array<Record<string, unknown>>,
  amountOut: BigInt("1350000000000000000"),
  failSwap: false,
}));

vi.mock("@/lib/deputy/chain", () => ({
  publicClient: () => ({
    readContract: async (req: { functionName: string }) => {
      if (req.functionName === "getAmountsOut") return [BigInt(5_000_000), h.amountOut];
      if (req.functionName === "getReserves") return [BigInt("21994462839853926227868"), BigInt("81186112117"), 0];
      if (req.functionName === "balanceOf") return BigInt(20_000_000);
      throw new Error(`unexpected read ${req.functionName}`);
    },
    getGasPrice: async () => BigInt(12_000_000_000),
    getBalance: async () => BigInt("50000000000000000"),
    getTransactionReceipt: async () => ({ logs: [] }),
  }),
}));
vi.mock("@/lib/privy/client", () => ({
  privyPost: async (_path: string, body: Record<string, unknown>) => {
    h.policies.push(body);
    return { id: "pol_swap" };
  },
  setWalletPolicies: async (_id: string, ids: string[]) => {
    h.attached.push(ids);
  },
}));
vi.mock("@/lib/privy/executor", () => ({
  executeViaPrivy: async (_id: string, _from: string, call: { to: string; data: string; value?: bigint; label?: string }) => {
    h.calls.push(call);
    if (h.failSwap && call.label === "swap") throw new Error("reverted");
    return { txHash: `0x${call.label === "swap" ? "aa" : "bb"}${"0".repeat(62)}`, explorerUrl: "https://x" };
  },
}));
vi.mock("@/lib/launch/deployment-service", () => ({
  launchChainConfig: () => ({ factory: "0x1111111111111111111111111111111111111111", token: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21", chainId: 1088 }),
}));
vi.mock("@/lib/db/account-moves", () => ({
  recordAccountMove: (row: Record<string, unknown>) => {
    h.recorded.push(row);
    return row;
  },
}));

import { swapFromAccount } from "./swap";
import { METIS_SWAP_VENUE } from "./swap-venue";
import { SWAP_TOKENS_FOR_METIS_ABI } from "@/lib/privy/swap-policy";
import type { AgentWallet } from "@/lib/db/schema";

const WALLET = {
  chatId: "web:0xfounder",
  founderAddress: "0x3333333333333333333333333333333333333333",
  privyWalletId: "pw_swap",
  privyWalletAddress: "0x2222222222222222222222222222222222222222",
  policyId: "pol_base",
  perCampaignCapBase: 50_000_000,
  chainId: 1088,
  createdAt: 1,
  updatedAt: 1,
} as AgentWallet;

beforeEach(() => {
  h.policies = [];
  h.attached = [];
  h.calls = [];
  h.recorded = [];
  h.amountOut = BigInt("1350000000000000000");
  h.failSwap = false;
});

describe("swapFromAccount", () => {
  it("signs exactly approve-then-swap, back to the account, and re-locks", async () => {
    const agreed = BigInt("1336500000000000000"); // the quote less 1%
    const r = await swapFromAccount("0x3333333333333333333333333333333333333333", WALLET, "usdc_to_metis", BigInt(5_000_000), agreed);
    expect(r.ok).toBe(true);
    expect(h.attached).toEqual([["pol_swap"], ["pol_base"]]);
    expect(h.calls.map((c) => c.label)).toEqual(["swap-approve", "swap"]);

    const approve = decodeFunctionData({ abi: erc20Abi, data: h.calls[0]!.data as `0x${string}` });
    expect(h.calls[0]!.to).toBe(METIS_SWAP_VENUE.usdc);
    expect(approve.args).toEqual([METIS_SWAP_VENUE.router, BigInt(5_000_000)]);

    const swap = decodeFunctionData({ abi: SWAP_TOKENS_FOR_METIS_ABI, data: h.calls[1]!.data as `0x${string}` });
    expect(h.calls[1]!.to).toBe(METIS_SWAP_VENUE.router);
    const [amountIn, amountOutMin, path, to] = swap.args as readonly [bigint, bigint, readonly string[], string, bigint];
    expect(amountIn).toBe(BigInt(5_000_000));
    expect(amountOutMin).toBe(agreed);
    expect(path).toEqual([METIS_SWAP_VENUE.usdc, METIS_SWAP_VENUE.metis]);
    expect(to).toBe(WALLET.privyWalletAddress);

    expect(h.policies[0]!.name).toBe("mandate:web:0xfounder:swap");
    expect(h.recorded[0]).toMatchObject({ kind: "swap", assetIn: "usdc", assetOut: "metis", amountIn: BigInt(5_000_000) });
  });

  it("sends nothing when the price has moved below what the founder agreed to", async () => {
    h.amountOut = BigInt("1330000000000000000"); // within the impact limit, below the agreed least
    const r = await swapFromAccount("0x3333333333333333333333333333333333333333", WALLET, "usdc_to_metis", BigInt(5_000_000), BigInt("1336500000000000000"));
    expect(r).toMatchObject({ ok: false, code: "price_moved" });
    expect(h.calls).toEqual([]);
    expect(h.attached).toEqual([]);
  });

  it("re-locks the wallet even when the swap fails, and records nothing", async () => {
    h.failSwap = true;
    const r = await swapFromAccount("0x3333333333333333333333333333333333333333", WALLET, "usdc_to_metis", BigInt(5_000_000), BigInt("1336500000000000000"));
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(h.attached).toEqual([["pol_swap"], ["pol_base"]]);
    expect(h.recorded).toEqual([]);
  });
});
