import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/wallet/use-wallet", () => ({ useWallet: () => ({ address: null, onChain: () => false, switchToChain: vi.fn(), getWalletClient: () => null }) }));
vi.mock("@/components/campaigns/embedded-wallet-bridge", () => ({ EmbeddedWalletBridge: () => null }));

import { YourWallet } from "./your-wallet";

/**
 * YOUR WALLET (26 Oct 2026): Metis first and always, the way a withdrawal leaves decided by the network's
 * USDC (GOAT's takes a signature and Sage pays the gas; Metis m.USDC does not, so the wallet sends it and
 * pays its own small METIS fee), and a paused network shown only while it still holds this wallet's money.
 */
const address = "0x3a60af43c67dd9d552f180d30d9a042948078341";
const rail = (chainId: number, over: Record<string, unknown>) => ({
  ok: true,
  address,
  token: chainId === 1088 ? "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21" : "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
  explorerUrl: `https://explorer/${address}`,
  usd: 0,
  usdcBase: "0",
  legacyGas: true,
  feeWei: "2000000000000000",
  paused: chainId !== 1088,
  ...over,
});
const serve = (byChain: Record<number, Record<string, unknown>>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const id = Number(new URL(url, "http://x").searchParams.get("chainId"));
      const body = byChain[id] ?? rail(id, { network: "Arc", gasless: true, nativeSymbol: "USDC", nativeWei: "0" });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
const metis = (over: Record<string, unknown> = {}) => rail(1088, { network: "Metis", gasless: false, nativeSymbol: "METIS", nativeWei: "0", ...over });
const goat = (over: Record<string, unknown> = {}) => rail(2345, { network: "GOAT Network", gasless: true, nativeSymbol: "BTC", nativeWei: "0", ...over });

describe("Your wallet", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("on Metis: the deposit address, the live balance, and a withdrawal the wallet sends itself", async () => {
    serve({ 1088: metis({ usd: 1.1, usdcBase: "1100000" }), 2345: goat() });
    render(<YourWallet address={address} />);
    expect(screen.getByText(address)).toBeTruthy();
    const balances = await screen.findAllByText("$1.10");
    expect(balances.some((el) => el.classList.contains("yw-bal"))).toBe(true);
    expect(screen.getByText(/Deposit — send USDC on Metis to/)).toBeTruthy();
    expect(screen.getByText(/sent from your wallet, which pays a network fee of under a cent in METIS/)).toBeTruthy();
    // GOAT holds nothing here, so it is not offered at all
    expect(screen.queryByText(/GOAT/)).toBeNull();
  });

  it("short of METIS, it says how much and where to get it, and sends nothing", async () => {
    serve({ 1088: metis({ usd: 2, usdcBase: "2000000" }), 2345: goat() });
    render(<YourWallet address={address} />);
    await screen.findAllByText("$2.00");
    await userEvent.type(screen.getByPlaceholderText(/address to send to/), `0x${"1".repeat(40)}`);
    await userEvent.type(screen.getByPlaceholderText("USDC"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(await screen.findByText(/needs about 0\.002 METIS for the network fee to send this withdrawal/)).toBeTruthy();
    expect(screen.getByText(/from Binance, OKX or another exchange/)).toBeTruthy();
  });

  it("money left on GOAT is shown to withdraw (gasless there), never as a place to deposit", async () => {
    serve({ 1088: metis(), 2345: goat({ usd: 1.1, usdcBase: "1100000" }) });
    render(<YourWallet address={address} />);
    expect(await screen.findByRole("button", { name: /Metis Mainnet/ })).toBeTruthy();
    // lands on the rail that holds the money
    expect(await screen.findByText(/GOAT Network is paused for new money/)).toBeTruthy();
    expect(screen.queryByText(/Deposit — send USDC on GOAT/)).toBeNull();
    expect(screen.getByText(/You sign; Sage pays the gas/)).toBeTruthy();
  });
});
