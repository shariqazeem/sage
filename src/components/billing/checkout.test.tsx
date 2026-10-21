import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkout, type CheckoutProps } from "./checkout";

/**
 * THE CHECKOUT (21 Oct 2026): what you get, how you pay, one button, a receipt. These hold the parts a
 * founder sees before anything is paid: the price and the renewal line, the balance as the one-click
 * method, renewal on by default, and a promo code changing what is due (or making it free).
 */
vi.mock("@/lib/wallet/use-wallet", () => ({ useWallet: () => ({ available: true, address: null, onChain: () => false, connect: vi.fn(), switchToChain: vi.fn(), getWalletClient: () => null }) }));

const base: CheckoutProps = {
  plan: { id: "pro", name: "Pro", blurb: "For founders and small teams who pay people every week.", priceUsd: 29, highlights: ["Everything in Free", "Unlimited live jobs, up to $5,000 of work a month"] },
  current: { name: "Free", isFree: true },
  quote: { ok: true, until: 1_800_000_000 + 30 * 86_400, creditDays: 0, renewing: false },
  billing: { chainId: 1088, network: "Metis Andromeda", token: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21", to: "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6" },
  balance: { address: "0x2222222222222222222222222222222222222222", usd: 40 },
  balanceClosed: null,
  autoRenew: true,
  canManage: true,
  periodDays: 30,
};

afterEach(() => vi.unstubAllGlobals());

describe("the checkout", () => {
  it("shows the plan, the price due, the balance as the one-click method, and renewal on by default", () => {
    render(<Checkout {...base} />);
    expect(screen.getByText("Sage Pro")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay $29.00" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Sage balance/ }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/renews every 30 days from your Sage balance/)).toBeTruthy();
  });

  it("without a balance yet, says how the balance opens and pays by wallet", () => {
    render(<Checkout {...base} balance={null} balanceClosed="Sage is opening on Metis. New jobs and accounts open there the moment its vault factory is live." />);
    expect(screen.getByText(/Sage is opening on Metis/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Your wallet/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("a percent code lowers what is due; a free-days code makes it free, with nothing to pay", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      json: async () =>
        url.includes("code=HALF")
          ? { ok: true, code: "HALF", kind: "percent", percentOff: 50, discountedUsd: 14.5, label: "50% off your first Pro payment" }
          : { ok: true, code: "RISE30", kind: "days", days: 30, label: "30 days of Pro, free" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<Checkout {...base} initialCode="HALF" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay $14.50" })).toBeTruthy());
    expect(screen.getByText(/HALF, 50% off/)).toBeTruthy();
    unmount();
    render(<Checkout {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await userEvent.type(screen.getByLabelText("Promo code"), "rise30");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start 30 free days" })).toBeTruthy());
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Your wallet/ })).toBeNull();
  });

  it("someone who can't manage the plan sees why, and can't pay", () => {
    render(<Checkout {...base} canManage={false} />);
    expect(screen.getByText(/Only the workspace owner or an admin/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay $29.00" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
