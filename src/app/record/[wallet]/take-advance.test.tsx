import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * THE ADVANCE IN TWO STEPS (26 Oct 2026, on Metis). The approval comes first because repayment is collected
 * under it; taking the money stays locked until the chain shows that approval, whatever the page assumes.
 */
vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({ address: null, available: false, chainId: null, connecting: false, onMetis: false, onChain: () => false, connect: vi.fn(), switchToMetis: vi.fn(), switchToChain: vi.fn(), getWalletClient: () => null }),
}));

import { TakeAdvanceButton } from "./take-advance";

const props = { wallet: "0x1111111111111111111111111111111111111111", offerUsd: 2, multiple: 1, waterfallBps: 5000, pot: "0x2222222222222222222222222222222222222222", token: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21" };

describe("taking an advance", () => {
  it("asks for the approval first, and keeps the money locked until it is there", () => {
    render(<TakeAdvanceButton {...props} approved={false} needsFee={false} />);
    expect(screen.getByRole("button", { name: /1\. Approve repayment/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /2\. Take \$2\.00/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/collect up to \$2\.00 from your next verified payouts on Metis, 50% of each/)).toBeTruthy();
  });

  it("says the pot covers the approval's fee when the wallet has no METIS", () => {
    render(<TakeAdvanceButton {...props} approved={false} needsFee />);
    expect(screen.getByText(/the pot covers its network fee/)).toBeTruthy();
  });

  it("opens the second step once the approval is confirmed", () => {
    render(<TakeAdvanceButton {...props} approved needsFee={false} />);
    expect(screen.getByRole("button", { name: /Repayment approved/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /2\. Take \$2\.00/ })).toHaveProperty("disabled", false);
  });
});
