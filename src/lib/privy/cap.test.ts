import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RAISING THE CAP IS A NEW POLICY, NOT AN EDIT, and it must carry the reclaim address across: a
 * bigger cap that quietly dropped the "unspent goes only home" rule would widen where money can go
 * while claiming to widen only how much. And the row must change last, so a Privy failure never
 * leaves a row promising a cap the enclave does not enforce.
 */
const row = { chatId: "web:0xabc", founderAddress: `0x${"a".repeat(40)}`, privyWalletId: "pw_1", privyWalletAddress: `0x${"b".repeat(40)}`, policyId: "pol_old", perCampaignCapBase: 50_000_000, chainId: 2345, createdAt: 0, updatedAt: 0 };
const created = vi.fn(async (spec: unknown) => { void spec; return "pol_new"; });
const attached = vi.fn(async (id: string, policies: string[]) => { void id; void policies; });
const updated = vi.fn((chatId: string, policyId: string, cap: number) => { void chatId; void policyId; void cap; });
vi.mock("./mandate", () => ({ createMandatePolicy: (spec: unknown) => created(spec) }));
vi.mock("./client", () => ({ setWalletPolicies: (id: string, p: string[]) => attached(id, p) }));
vi.mock("@/lib/db/agent-wallets", () => ({
  updateMandate: (chatId: string, policyId: string, cap: number) => updated(chatId, policyId, cap),
  getAgentWallet: () => ({ ...row, policyId: "pol_new", perCampaignCapBase: 200_000_000 }),
}));
vi.mock("@/lib/launch/deployment-service", () => ({ launchChainConfig: () => ({ factory: `0x${"f".repeat(40)}`, token: `0x${"c".repeat(40)}`, configured: true }) }));

const { setAccountCap } = await import("./cap");

describe("changing an account's per-campaign cap", () => {
  beforeEach(() => { created.mockClear(); attached.mockClear(); updated.mockClear(); });

  it("creates a new mandate with the new cap and the SAME reclaim address, repoints the wallet, then records it", async () => {
    const saved = await setAccountCap(row, BigInt(200_000_000));
    expect(created).toHaveBeenCalledTimes(1);
    const spec = created.mock.calls[0][0] as unknown as { perCampaignCapBase: bigint; reclaim: string; factory: string };
    expect(spec.perCampaignCapBase).toBe(BigInt(200_000_000));
    expect(spec.reclaim.toLowerCase()).toBe(row.founderAddress);
    expect(attached).toHaveBeenCalledWith("pw_1", ["pol_new"]);
    expect(updated).toHaveBeenCalledWith("web:0xabc", "pol_new", 200_000_000);
    expect(saved.perCampaignCapBase).toBe(200_000_000);
    // the row changes only after the wallet is on the new policy
    expect(attached.mock.invocationCallOrder[0]).toBeLessThan(updated.mock.invocationCallOrder[0]);
  });

  it("refuses a cap outside the opening bounds without touching Privy", async () => {
    await expect(setAccountCap(row, BigInt(0))).rejects.toThrow(/between/);
    await expect(setAccountCap(row, BigInt(20_000_000_000))).rejects.toThrow(/between/);
    expect(created).not.toHaveBeenCalled();
  });
});
