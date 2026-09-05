import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/wallet/use-wallet", () => ({ useWallet: () => ({ address: null, getWalletClient: () => null }) }));
vi.mock("@/components/campaigns/embedded-wallet-bridge", () => ({ EmbeddedWalletBridge: () => null }));

import { YourWallet } from "./your-wallet";

const address = "0x3a60af43c67dd9d552f180d30d9a042948078341";

describe("Your wallet — deposit is the address, withdraw is gasless", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, address, network: "GOAT Network", usd: 1.1, usdcBase: "1100000", explorerUrl: "https://explorer.goat.network/address/" + address }), { status: 200 })));
  });

  it("shows the address to deposit to and the live balance", async () => {
    render(<YourWallet address={address} />);
    expect(screen.getByText(address)).toBeTruthy();
    expect(await screen.findByText("$1.10")).toBeTruthy();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeTruthy();
    expect(screen.getByText(/You sign; Sage pays the gas/)).toBeTruthy();
  });
});
