import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CHAT DOOR TAKES NO NEW MONEY ON GOAT (21 Oct 2026), AND OPENS ON METIS (24 Oct 2026). GOAT's USDC
 * lost Stargate support on 23 October 2026. So the chat never mints a GOAT wallet, never tells anyone to
 * send funds to one, and never launches from one; a wallet there keeps its balance, its status and its
 * way out. New chat wallets open on the default network (Metis), and only once it is open.
 */
const h = vi.hoisted(() => ({ onboard: vi.fn(), deploy: vi.fn(), stipend: vi.fn(), metisOpen: false, setAside: vi.fn() }));

vi.mock("@/lib/deputy/chain", () => ({
  publicClient: () => ({ readContract: async () => BigInt(9_000_000), getBalance: async () => BigInt(0) }),
}));
vi.mock("@/lib/privy/onboarding", () => ({
  founderBinding: (chatId: string) =>
    chatId === "hasWallet"
      ? { chatId, founderAddress: "0x1111111111111111111111111111111111111111", privyWalletId: "pw_1", privyWalletAddress: "0x2222222222222222222222222222222222222222", policyId: "pol_1", perCampaignCapBase: 50_000_000, chainId: 2345 }
      : null,
  onboardWalletless: (...a: unknown[]) => h.onboard(...a),
  treasuryChainId: () => 1088,
}));
vi.mock("@/lib/launch/deployment-service", async (orig) => {
  const real = await orig<typeof import("@/lib/launch/deployment-service")>();
  return { ...real, launchClosedReason: (id: number) => (id === 1088 && h.metisOpen ? null : real.launchClosedReason(id)) };
});
vi.mock("./chat-wallets", () => ({
  chatWallets: () => [],
  chatWalletOn: () => null,
  setAsideActiveWallet: (...a: unknown[]) => h.setAside(...a),
}));
vi.mock("@/lib/privy/deploy-runner", () => ({ deployCampaignViaPrivy: (...a: unknown[]) => h.deploy(...a) }));
vi.mock("@/lib/treasury/gas-stipend", () => ({ grantGasStipend: (...a: unknown[]) => h.stipend(...a), gasRefusalMessage: () => "" }));

import { callAgentWalletTool } from "./agent-wallet-tools";

const run = async (name: string, args: Record<string, unknown>, chat: string) => JSON.parse((await callAgentWalletTool(name, args, chat)).content[0]?.text ?? "{}");

beforeEach(() => {
  h.onboard.mockReset();
  h.deploy.mockReset();
  h.stipend.mockReset();
  h.setAside.mockReset();
  h.metisOpen = false;
});

describe("Telegram while GOAT is paused", () => {
  it("mints nothing while Metis is still opening, and says so", async () => {
    const r = await run("sage_setup_wallet", { perCampaignCapUsd: 50 }, "newChat");
    expect(r).toMatchObject({ ok: false, networkOpening: true });
    expect(r.message).toMatch(/opening on Metis/);
    expect(r.message).not.toMatch(/GOAT|BTC/);
    expect(h.onboard).not.toHaveBeenCalled();
  });

  it("once Metis is open, a new chat's wallet opens there, never on GOAT", async () => {
    h.metisOpen = true;
    h.onboard.mockResolvedValue({ privyWalletAddress: "0x3333333333333333333333333333333333333333", perCampaignCapBase: 50_000_000, reclaimAddress: "0x3333333333333333333333333333333333333333" });
    const r = await run("sage_setup_wallet", { perCampaignCapUsd: 50 }, "newChat");
    expect(r).toMatchObject({ ok: true, network: "Metis" });
    expect(h.onboard).toHaveBeenCalledWith(expect.objectContaining({ chatId: "newChat", chainId: 1088 }));
    expect(r.message).toMatch(/METIS for network fees/);
    expect(r.message).not.toMatch(/BTC/);
  });

  it("a GOAT wallet is set aside (still theirs) before the Metis one opens under the chat's key", async () => {
    h.metisOpen = true;
    h.setAside.mockReturnValue({ chatId: "hasWallet@2345", chainId: 2345, privyWalletAddress: "0x2222222222222222222222222222222222222222" });
    h.onboard.mockResolvedValue({ privyWalletAddress: "0x4444444444444444444444444444444444444444", perCampaignCapBase: 50_000_000, reclaimAddress: "0x4444444444444444444444444444444444444444" });
    const r = await run("sage_setup_wallet", { perCampaignCapUsd: 50 }, "hasWallet");
    expect(h.setAside).toHaveBeenCalledWith("hasWallet");
    expect(h.onboard).toHaveBeenCalledWith(expect.objectContaining({ chatId: "hasWallet", chainId: 1088 }));
    expect(r.olderWallet).toMatchObject({ network: "GOAT Network", address: "0x2222222222222222222222222222222222222222" });
  });

  it("never asks an existing wallet's owner to fund it", async () => {
    const r = await run("sage_setup_wallet", { perCampaignCapUsd: 50 }, "hasWallet");
    expect(r).toMatchObject({ ok: false, networkPaused: true, alreadySetUp: true });
    expect(r.message).toMatch(/Do not ask the founder to send funds/);
    expect(r.message).not.toMatch(/BTC/);
  });

  it("launches nothing from a GOAT wallet: no stipend, no deploy", async () => {
    const r = await run("sage_fund_and_launch", {}, "hasWallet");
    expect(r).toMatchObject({ ok: false, networkPaused: true });
    expect(r.message).toMatch(/Nothing was launched and nothing moved/);
    expect(h.stipend).not.toHaveBeenCalled();
    expect(h.deploy).not.toHaveBeenCalled();
  });

  it("still shows the balance, so the owner can always see and move their money", async () => {
    const r = await run("sage_agent_wallet_status", {}, "hasWallet");
    expect(r).toMatchObject({ ok: true, linked: true, balanceUsdc: 9 });
  });
});
