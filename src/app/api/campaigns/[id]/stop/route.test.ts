import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TWO OWNERS, TWO SIGNERS. A vault the founder deployed from their own wallet is stopped by that
 * wallet in the console, and this route only catalogues it. A vault the founder's ACCOUNT launched
 * is owned by the account's Privy wallet, so this route stops it THROUGH the account. Measured
 * 2026-09-11: the console offered the browser-wallet stop on an account-launched gig; it could only
 * revert with NotAuthorized.
 */
const FOUNDER = `0x${"1".repeat(40)}`;
const ACCOUNT = `0x${"a".repeat(40)}`;
const VAULT = `0x${"b".repeat(40)}`;
let session: string | null = FOUNDER;
const campaign = { id: "c1", posterWallet: FOUNDER, vaultAddress: VAULT, chainId: 5042002 };
const stop = vi.fn(async () => ({ revoke: { txHash: "0xrev" }, withdraw: { txHash: "0xwd" }, alreadyRevoked: false, recoveredBase: BigInt(2_500_000) }));
const setStatus = vi.fn();
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => session }));
vi.mock("@/lib/db/campaigns", () => ({ getCampaign: () => campaign, resolveStoppedCampaignSubmissions: () => 1, setCampaignStatus: (id: string, s: string) => setStatus(id, s) }));
vi.mock("@/lib/db/agent-wallets", () => ({ getAgentWalletByAddress: (a: string) => (a.toLowerCase() === ACCOUNT ? { chatId: "web:x", founderAddress: FOUNDER, privyWalletAddress: ACCOUNT, privyWalletId: "pw", policyId: "pol", perCampaignCapBase: 50_000_000, chainId: 5042002 } : null) }));
vi.mock("@/lib/campaigns/review-actions", () => ({ ownsCampaign: (c: { posterWallet: string }, w: string | null) => !!w && (c.posterWallet === w || (c.posterWallet === ACCOUNT && w === FOUNDER)) }));
vi.mock("@/lib/privy/stop-campaign", () => ({ stopCampaignViaPrivy: (...a: unknown[]) => stop(...(a as [])) }));

const { POST } = await import("./route");
const post = () => POST(new Request("http://x/api/campaigns/c1/stop", { method: "POST" }), { params: Promise.resolve({ id: "c1" }) });

describe("stopping a campaign", () => {
  beforeEach(() => { stop.mockClear(); setStatus.mockClear(); session = FOUNDER; campaign.posterWallet = FOUNDER; });

  it("a wallet-deployed vault: catalogue only, the founder's wallet already did the chain", async () => {
    const j = (await (await post()).json()) as { ok: boolean; viaAccount: unknown };
    expect(j.ok).toBe(true);
    expect(j.viaAccount).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith("c1", "cancelled");
  });

  it("an account-launched vault: stopped THROUGH the account, remaining USDC back to it", async () => {
    campaign.posterWallet = ACCOUNT;
    const j = (await (await post()).json()) as { ok: boolean; viaAccount: { withdrawTx: string; recoveredBase: string } };
    expect(j.ok).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(j.viaAccount.withdrawTx).toBe("0xwd");
    expect(j.viaAccount.recoveredBase).toBe("2500000");
    expect(setStatus).toHaveBeenCalledWith("c1", "cancelled");
  });

  it("a stranger cannot stop either", async () => {
    session = `0x${"9".repeat(40)}`;
    expect((await post()).status).toBe(403);
    expect(stop).not.toHaveBeenCalled();
  });

  it("a failed account stop leaves the campaign live and says why", async () => {
    campaign.posterWallet = ACCOUNT;
    stop.mockRejectedValueOnce(new Error("privy down"));
    const r = await post();
    expect(r.status).toBe(500);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
