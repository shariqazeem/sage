import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StartFlow } from "./start-flow";

/**
 * THREE RAILS, ONE LINE EACH. A founder choosing a door at sign-in should not have to reason about
 * chains afterwards: the email door says where its wallet lives, the wallet door says which rail each
 * wallet pays on, and the screen after sign-in names the rail they are on. Measured on the founder's
 * own account (11 Sep 2026): "with three chains, people including me will get confused".
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/auth/email-sign-in", () => ({ EmailSignIn: () => <button>Continue with email</button> }));
vi.mock("@/components/wallet/founder-sign-in", () => ({ FounderSignIn: ({ explainer }: { explainer?: ReactNode }) => <div data-testid="wallet-door">{explainer}</div> }));

describe("the start flow says what each door means for money", () => {
  it("the email door names both EVM mainnets; the wallet door names all three networks", () => {
    render(<StartFlow signedIn={false} address={null} hasMemberships={false} emailEnabled />);
    expect(screen.getByText(/keeps a wallet for you.*on GOAT Network or Arc/)).toBeTruthy();
    const door = screen.getByTestId("wallet-door").textContent ?? "";
    expect(door).toMatch(/Ethereum/);
    expect(door).toMatch(/GOAT Network or Arc/);
    expect(door).toMatch(/Starknet.*private rail/);
    expect(door).not.toMatch(/testnet/i);
  });

  it("after sign-in, names the rail the founder is on", () => {
    const { unmount } = render(<StartFlow signedIn address={`0x${"1".repeat(40)}`} chain="evm" hasMemberships={false} />);
    expect(screen.getByText(/Your money moves on GOAT Network or Arc/)).toBeTruthy();
    unmount();
    render(<StartFlow signedIn address={`0x${"2".repeat(63)}`} chain="starknet" hasMemberships={false} />);
    expect(screen.getByText(/Your money moves on Starknet, the private rail/)).toBeTruthy();
  });
});
