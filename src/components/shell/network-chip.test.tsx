import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { NetworkChip } from "@/components/app/network-chip";
import { GOAT_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";

/**
 * The chip names the SETTLEMENT network, and which one that is depends on who is signed in.
 * Hardcoded to GOAT, a founder signed in with a Starknet wallet read "GOAT Mainnet" on every
 * screen — a chain they hold nothing on and will never settle through.
 */
const session = { address: null as string | null, chain: null as string | null };
vi.mock("@/lib/auth/use-founder-session", () => ({ useFounderSession: () => session }));

beforeEach(() => {
  session.address = null;
  session.chain = null;
});

describe("the network chip", () => {
  it("names Starknet for a founder signed in with a Starknet wallet", () => {
    render(<NetworkChip chainId={STARKNET_MAINNET_KEY} />);
    expect(screen.getByText(/Starknet/i)).toBeTruthy();
  });

  it("names GOAT for an EVM founder, and by default", () => {
    render(<NetworkChip chainId={GOAT_MAINNET_CHAIN_ID} />);
    expect(screen.getByText(/GOAT/i)).toBeTruthy();
  });

  it("never labels a real-money chain as a testnet", () => {
    // The original reason this chip ignores the wallet's incidental chain.
    for (const id of [GOAT_MAINNET_CHAIN_ID, STARKNET_MAINNET_KEY]) {
      const { container, unmount } = render(<NetworkChip chainId={id} />);
      expect(container.textContent).not.toMatch(/sepolia|testnet/i);
      unmount();
    }
  });
});
