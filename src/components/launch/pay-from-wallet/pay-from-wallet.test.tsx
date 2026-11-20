import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { PayFromWalletApi } from "./use-pay-from-wallet";

const api = vi.fn<() => PayFromWalletApi>();
vi.mock("./use-pay-from-wallet", () => ({ usePayFromWallet: () => api() }));
vi.mock("@/components/campaigns/embedded-wallet-bridge", () => ({ EmbeddedWalletBridge: () => null }));

import { PayFromWallet } from "./pay-from-wallet";

const base = (over: Partial<PayFromWalletApi> = {}): PayFromWalletApi => ({
  phase: "ready",
  chainId: 1088,
  network: "Metis",
  owner: "0x1111111111111111111111111111111111111111",
  vault: "0x2222222222222222222222222222222222222222",
  walletKind: "injected",
  budgetUsd: 20,
  balances: { usdc: 25, metis: "0.08" },
  shortfalls: [],
  steps: (["create", "approve", "fund", "activate"] as const).map((step) => ({ step, label: step, status: "waiting", txHash: null, explorerUrl: null })),
  error: null,
  upgradeTo: undefined,
  campaignId: null,
  busy: false,
  pay: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  ...over,
});

afterEach(cleanup);

describe("PayFromWallet", () => {
  it("offers one button with the exact amount, and says what the wallet holds", () => {
    const state = base();
    api.mockReturnValue(state);
    render(<PayFromWallet jobId="job1" />);
    expect(screen.getByText(/Your wallet on Metis holds/).textContent).toMatch(/holds \$25\.00 m\.USDC and 0\.08 METIS\. This test needs \$20\.00\./);
    fireEvent.click(screen.getByRole("button", { name: "Pay $20.00 from your wallet" }));
    expect(state.pay).toHaveBeenCalledTimes(1);
  });

  it("says exactly what is short, and offers a re-check instead of a signature", () => {
    const state = base({ phase: "short", shortfalls: [{ what: "usdc", missing: BigInt(7_500_000), message: "Your wallet holds 12.50 m.USDC on Metis and this test needs 20.00. Add 7.50 m.USDC to 0x1111…1111 on the Metis network." }] });
    api.mockReturnValue(state);
    render(<PayFromWallet jobId="job1" />);
    expect(screen.getByText(/Add 7\.50 m\.USDC/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check my wallet again" }));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.pay).not.toHaveBeenCalled();
  });

  it("shows each step with its transaction link, and Continue once a launch has begun", () => {
    api.mockReturnValue(
      base({
        steps: [
          { step: "create", label: "Create this test's vault", status: "done", txHash: "0xaa", explorerUrl: "https://andromeda-explorer.metis.io/tx/0xaa" },
          { step: "approve", label: "Approve the exact budget", status: "confirming", txHash: "0xbb", explorerUrl: "https://andromeda-explorer.metis.io/tx/0xbb" },
          { step: "fund", label: "Fund the vault", status: "waiting", txHash: null, explorerUrl: null },
          { step: "activate", label: "Activate it", status: "waiting", txHash: null, explorerUrl: null },
        ],
      }),
    );
    render(<PayFromWallet jobId="job1" />);
    expect(screen.getByRole("link", { name: "Approve the exact budget: Confirming on Metis, view transaction" })).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["https://andromeda-explorer.metis.io/tx/0xaa", "https://andromeda-explorer.metis.io/tx/0xbb"]);
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("holds the button while the plan cannot launch yet, and shows a refusal without a button", () => {
    api.mockReturnValue(base());
    const { unmount } = render(<PayFromWallet jobId="job1" hold="Allocate the whole budget first." />);
    expect((screen.getByRole("button", { name: "Pay $20.00 from your wallet" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    api.mockReturnValue(base({ phase: "refused", error: "GOAT is paused for new jobs." }));
    render(<PayFromWallet jobId="job1" />);
    expect(screen.getByRole("alert").textContent).toBe("GOAT is paused for new jobs.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says it is live, with the links, and asks for nothing more", () => {
    api.mockReturnValue(base({ phase: "live", campaignId: "c1" }));
    render(<PayFromWallet jobId="job1" />);
    expect(screen.getByText(/Paid from your wallet\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the test" }).getAttribute("href")).toBe("/t/c1");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
