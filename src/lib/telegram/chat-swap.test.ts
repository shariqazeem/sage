import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SWAPPING FROM CHAT. The founder states the amount; the tool quotes it; the quote is read back; only a
 * confirmed quote is swapped, and exactly as quoted (same direction, amount and least-received). The
 * model never carries a number between the two calls.
 */
const h = vi.hoisted(() => ({ quote: vi.fn(), swap: vi.fn() }));

vi.mock("@/lib/privy/onboarding", () => ({
  founderBinding: (chatId: string) =>
    chatId === "metisChat"
      ? { chatId, founderAddress: "0x5555555555555555555555555555555555555555", privyWalletId: "pw_m", privyWalletAddress: "0x5555555555555555555555555555555555555555", policyId: "pol_m", perCampaignCapBase: 50_000_000, chainId: 1088 }
      : chatId === "goatChat"
        ? { chatId, founderAddress: "0x6666666666666666666666666666666666666666", privyWalletId: "pw_g", privyWalletAddress: "0x6666666666666666666666666666666666666666", policyId: "pol_g", perCampaignCapBase: 50_000_000, chainId: 2345 }
        : null,
  onboardWalletless: vi.fn(),
  treasuryChainId: () => 1088,
}));
vi.mock("@/lib/treasury/swap", () => ({
  quoteAccountSwap: (...a: unknown[]) => h.quote(...a),
  swapFromAccount: (...a: unknown[]) => h.swap(...a),
}));

import { callAgentWalletTool } from "./agent-wallet-tools";

const run = async (name: string, args: Record<string, unknown>, chat: string) => JSON.parse((await callAgentWalletTool(name, args, chat)).content[0]?.text ?? "{}");
const METIS = (n: number) => BigInt(Math.round(n * 1e6)) * BigInt(1e12);

beforeEach(() => {
  h.quote.mockReset();
  h.swap.mockReset();
});

describe("chat swap", () => {
  it("quotes the founder's own amount, parsed exactly, and asks for a yes", async () => {
    h.quote.mockResolvedValue({ ok: true, quote: { side: "metis_to_usdc", amountIn: METIS(5), amountOut: BigInt(18_400_000), minOut: BigInt(18_216_000), feeWei: METIS(0.0046), slippageBps: 100, priceImpactBps: 40, metisPriceUsdcBase: BigInt(3_690_000), venue: "Netswap" } });
    const r = await run("sage_request_swap", { direction: "metis_to_usdc", amount: "5" }, "metisChat");
    expect(h.quote.mock.calls[0]![2]).toBe(METIS(5));
    expect(r).toMatchObject({ ok: true, needsConfirmation: true, atLeast: "18.22 USDC" });
    expect(r.message).toMatch(/sage_confirm_swap ONLY after they clearly say yes/);
  });

  it("swaps exactly what was quoted, once", async () => {
    h.quote.mockResolvedValue({ ok: true, quote: { side: "metis_to_usdc", amountIn: METIS(5), amountOut: BigInt(18_400_000), minOut: BigInt(18_216_000), feeWei: METIS(0.0046), slippageBps: 100, priceImpactBps: 40, metisPriceUsdcBase: BigInt(3_690_000), venue: "Netswap" } });
    h.swap.mockResolvedValue({ ok: true, side: "metis_to_usdc", amountIn: METIS(5), amountOut: BigInt(18_390_000), txHash: "0xabc", approveTxHash: null, explorerUrl: "https://x/tx/0xabc" });
    await run("sage_request_swap", { direction: "metis_to_usdc", amount: "5" }, "metisChat");
    const r = await run("sage_confirm_swap", {}, "metisChat");
    expect(h.swap).toHaveBeenCalledTimes(1);
    const [, , side, amountIn, minOut] = h.swap.mock.calls[0]!;
    expect([side, amountIn, minOut]).toEqual(["metis_to_usdc", METIS(5), BigInt(18_216_000)]);
    expect(r.message).toMatch(/Swapped 5 METIS for 18.39 USDC/);
    // a second confirm has nothing to confirm
    expect((await run("sage_confirm_swap", {}, "metisChat")).error).toMatch(/no prepared swap/);
  });

  it("refuses anywhere but Metis, and refuses a number it can't read", async () => {
    expect((await run("sage_request_swap", { direction: "metis_to_usdc", amount: "5" }, "goatChat")).error).toMatch(/Metis only/);
    expect((await run("sage_request_swap", { direction: "metis_to_usdc", amount: "five" }, "metisChat")).error).toMatch(/how much/);
    expect(h.quote).not.toHaveBeenCalled();
  });
});
