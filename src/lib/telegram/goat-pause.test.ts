import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CHAT DOOR TAKES NO NEW MONEY ON GOAT (21 Oct 2026). Telegram's walletless accounts live on GOAT,
 * whose USDC loses Stargate support on 23 October 2026. So the chat never mints a new GOAT wallet,
 * never tells anyone to send funds to one, and never launches from one; a wallet that exists keeps its
 * balance, its status and its way out.
 */
const h = vi.hoisted(() => ({ onboard: vi.fn(), deploy: vi.fn(), stipend: vi.fn() }));

vi.mock("@/lib/deputy/chain", () => ({
  publicClient: () => ({ readContract: async () => BigInt(9_000_000), getBalance: async () => BigInt(0) }),
}));
vi.mock("@/lib/privy/onboarding", () => ({
  founderBinding: (chatId: string) =>
    chatId === "hasWallet"
      ? { chatId, founderAddress: "0x1111111111111111111111111111111111111111", privyWalletId: "pw_1", privyWalletAddress: "0x2222222222222222222222222222222222222222", policyId: "pol_1", perCampaignCapBase: 50_000_000, chainId: 2345 }
      : null,
  onboardWalletless: (...a: unknown[]) => h.onboard(...a),
}));
vi.mock("@/lib/privy/deploy-runner", () => ({ deployCampaignViaPrivy: (...a: unknown[]) => h.deploy(...a) }));
vi.mock("@/lib/treasury/gas-stipend", () => ({ grantGasStipend: (...a: unknown[]) => h.stipend(...a), gasRefusalMessage: () => "" }));

import { callAgentWalletTool } from "./agent-wallet-tools";

const run = async (name: string, args: Record<string, unknown>, chat: string) => JSON.parse((await callAgentWalletTool(name, args, chat)).content[0]?.text ?? "{}");

beforeEach(() => {
  h.onboard.mockReset();
  h.deploy.mockReset();
  h.stipend.mockReset();
});

describe("Telegram while GOAT is paused", () => {
  it("mints no new GOAT wallet, and says where new work goes", async () => {
    const r = await run("sage_setup_wallet", { perCampaignCapUsd: 50 }, "newChat");
    expect(r).toMatchObject({ ok: false, networkPaused: true });
    expect(r.message).toMatch(/paused/);
    expect(r.message).toMatch(/Metis/);
    expect(h.onboard).not.toHaveBeenCalled();
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
