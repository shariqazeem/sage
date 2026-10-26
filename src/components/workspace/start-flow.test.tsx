import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { StartFlow } from "./start-flow";

/**
 * THE FIRST RUN (19 Oct 2026). Email first; MetaMask is the second door, and the only other one: two
 * doors to the same account on Metis (26 Oct 2026, Starknet closed, no "more options"); then two
 * choices, not four; then the workspace's name. Every line says what a door means for money, and none
 * says "testnet".
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/auth/email-sign-in", () => ({ EmailSignIn: () => <button>Continue with email</button> }));
vi.mock("@/components/wallet/founder-sign-in", () => ({
  FounderSignIn: ({ explainer }: { explainer?: ReactNode }) => <div data-testid="wallet-door">{explainer}</div>,
}));

describe("the first run", () => {
  it("email first, MetaMask second, and nothing else: both open the same account on Metis", () => {
    render(<StartFlow signedIn={false} address={null} hasMemberships={false} emailEnabled />);
    expect(screen.getByText(/Sign in with your email\. Sage keeps an account for you on Metis/)).toBeTruthy();
    expect(screen.getByText("or use MetaMask")).toBeTruthy();
    const door = screen.getByTestId("wallet-door");
    expect(door.textContent).toMatch(/The same account either way: it opens on Metis/);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/Starknet|Arc\b|GOAT|testnet/i);
    expect(screen.queryByRole("button", { name: /More sign-in options/ })).toBeNull();
  });

  it("without the email door, MetaMask is the door", () => {
    render(<StartFlow signedIn={false} address={null} hasMemberships={false} />);
    expect(screen.getByText(/Sign in with MetaMask or another Ethereum wallet/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Starknet/);
  });

  it("a new workspace goes to Home for an email and a wallet alike", async () => {
    const created = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", created);
    render(<StartFlow signedIn address={`0x${"1".repeat(40)}`} hasMemberships={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Pay people for work/ }));
    await userEvent.type(screen.getByPlaceholderText("Acme Labs"), "Acme");
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(push).toHaveBeenLastCalledWith("/workspace");
    vi.unstubAllGlobals();
  });

  it("two choices after sign-in: pay people, or get paid", () => {
    render(<StartFlow signedIn address={`0x${"1".repeat(40)}`} hasMemberships={false} />);
    const choices = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(choices.filter((t) => /Pay people for work|Get paid for work/.test(t))).toHaveLength(2);
    expect(choices.some((t) => /Let Sage run it|Test my product/.test(t))).toBe(false);
  });

  it("paying people asks one thing, the workspace's name, and says the plan they start on", async () => {
    render(<StartFlow signedIn address={`0x${"1".repeat(40)}`} hasMemberships={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Pay people for work/ }));
    expect(screen.getByText("Name your workspace")).toBeTruthy();
    expect(screen.getByText(/You start on Free: one live job at a time/)).toBeTruthy();
  });
});
