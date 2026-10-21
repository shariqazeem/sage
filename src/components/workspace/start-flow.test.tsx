import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { StartFlow } from "./start-flow";

/**
 * THE FIRST RUN (19 Oct 2026). Email first; a wallet is the second door, Ethereum only until the
 * person asks for more (Starknet is a secondary network); then two choices, not four; then the
 * workspace's name. Every line says what a door means for money, and none says "testnet".
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/auth/email-sign-in", () => ({ EmailSignIn: () => <button>Continue with email</button> }));
vi.mock("@/components/wallet/founder-sign-in", () => ({
  FounderSignIn: ({ explainer, families }: { explainer?: ReactNode; families?: string }) => <div data-testid="wallet-door" data-families={families}>{explainer}</div>,
}));

describe("the first run", () => {
  it("email first; the wallet door is Ethereum on Metis until more options are asked for", async () => {
    render(<StartFlow signedIn={false} address={null} hasMemberships={false} emailEnabled />);
    expect(screen.getByText(/Sign in with your email/)).toBeTruthy();
    const door = screen.getByTestId("wallet-door");
    expect(door.dataset.families).toBe("evm");
    expect(door.textContent).toMatch(/Payments run on Metis\./);
    expect(door.textContent).not.toMatch(/GOAT/);
    expect(door.textContent).not.toMatch(/Starknet|testnet/i);
    await userEvent.click(screen.getByRole("button", { name: "More sign-in options" }));
    expect(screen.getByTestId("wallet-door").dataset.families).toBe("all");
    expect(screen.getByTestId("wallet-door").textContent).toMatch(/Starknet is for private payouts/);
  });

  it("two choices after sign-in: pay people, or get paid", () => {
    render(<StartFlow signedIn address={`0x${"1".repeat(40)}`} chain="evm" hasMemberships={false} />);
    const choices = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(choices.filter((t) => /Pay people for work|Get paid for work/.test(t))).toHaveLength(2);
    expect(choices.some((t) => /Let Sage run it|Test my product/.test(t))).toBe(false);
  });

  it("paying people asks one thing, the workspace's name, and says the plan they start on", async () => {
    render(<StartFlow signedIn address={`0x${"1".repeat(40)}`} chain="evm" hasMemberships={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Pay people for work/ }));
    expect(screen.getByText("Name your workspace")).toBeTruthy();
    expect(screen.getByText(/You start on Free: one live job at a time/)).toBeTruthy();
  });
});
