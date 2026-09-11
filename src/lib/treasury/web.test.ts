import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE ACCOUNT PER NETWORK. USDC on GOAT is not USDC on Arc, so an account is a wallet ON a chain,
 * and the one the mandate runs from is the one on the product's default chain. Two things must hold
 * or a founder ends up funding the wrong wallet: a legacy bare row is recognised by its OWN chain
 * column, and an account on another chain never shadows the default one.
 */
const rows = new Map<string, { chatId: string; chainId: number; privyWalletAddress: string }>();
vi.mock("@/lib/db/agent-wallets", () => ({ getAgentWallet: (chatId: string) => rows.get(chatId) ?? null }));
vi.mock("@/lib/privy/onboarding", () => ({
  treasuryChainId: () => 2345,
  onboardFounder: vi.fn(async (input: { chatId: string; chainId?: number }) => {
    rows.set(input.chatId, { chatId: input.chatId, chainId: input.chainId ?? 2345, privyWalletAddress: `0x${input.chatId.length.toString(16).padStart(40, "a")}` });
  }),
}));
vi.mock("@/lib/launch/deployment-service", () => ({ LAUNCH_ENABLED_CHAINS: [2345, 5042002, 59902] }));

const { createWebTreasury, getWebTreasury, getWebTreasuryOn, listWebTreasuries, webTreasuryKey, webTreasuryWallets } = await import("./web");
const F = `0x${"1".repeat(40)}`;

describe("one account per network", () => {
  beforeEach(() => rows.clear());

  it("keys the default chain's account bare and every other chain's by chain id", () => {
    expect(webTreasuryKey(F)).toBe(`web:${F.toLowerCase()}`);
    expect(webTreasuryKey(F, 5042002)).toBe(`web:${F.toLowerCase()}@5042002`);
  });

  it("a legacy bare row on Arc is the ARC account, not the default one — its chain column decides", () => {
    rows.set(webTreasuryKey(F), { chatId: webTreasuryKey(F), chainId: 5042002, privyWalletAddress: "0xarc" });
    expect(getWebTreasuryOn(F, 2345)).toBeNull();
    expect(getWebTreasuryOn(F, 5042002)?.privyWalletAddress).toBe("0xarc");
    expect(listWebTreasuries(F).map((t) => t.chainId)).toEqual([5042002]);
    // the mandate runs from the only account the founder has, not from nothing
    expect(getWebTreasury(F)?.chainId).toBe(5042002);
  });

  it("opening the default chain's account beside a legacy Arc row uses the suffixed key, and the mandate sees the default one", async () => {
    rows.set(webTreasuryKey(F), { chatId: webTreasuryKey(F), chainId: 5042002, privyWalletAddress: "0xarc" });
    await createWebTreasury(F, 50);
    expect(rows.has(webTreasuryKey(F, 2345))).toBe(true);
    expect(getWebTreasury(F)?.chainId).toBe(2345);
    // mainnet first, then the testnet
    expect(listWebTreasuries(F).map((t) => t.chainId)).toEqual([2345, 5042002]);
    expect(webTreasuryWallets(F)).toHaveLength(2);
  });

  it("is idempotent per chain: opening twice on one chain is one wallet", async () => {
    const a = await createWebTreasury(F, 50, 5042002);
    const b = await createWebTreasury(F, 99, 5042002);
    expect(b.chatId).toBe(a.chatId);
    expect(rows.size).toBe(1);
  });
});
