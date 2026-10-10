import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketplaceBoard } from "./marketplace-board";
import type { MarketplaceRow } from "@/lib/campaigns/marketplace";
import type { SettlementRail } from "@/lib/db/schema";

const row = (rail: SettlementRail, title: string, chainId = rail === "starknet" ? 900001 : 2345): MarketplaceRow => ({
  key: `k-${title}`,
  campaignId: `c-${title}`,
  campaignTitle: "Campaign",
  boardPath: `/c/c-${title}`,
  title,
  objective: "do the thing",
  targetSurface: "https://example.com",
  productHost: "example.com",
  criteria: ["a"],
  evidenceList: ["b"],
  rewardUsd: 1, denominated: null,
  remainingSlots: 1,
  maxCompletions: 1,
  tokenSymbol: "USDC",
  isTestnet: false,
  settlementRail: rail,
  chainId,
  autopays: true,
  effort: "quick",
});

const ROWS = [row("evm", "goat-work"), row("starknet", "private-work")];
const ROWS_WITH_ARC = [...ROWS, row("evm", "arc-work", 5042)];
const show = (viewerRails?: SettlementRail[]) =>
  render(<MarketplaceBoard rows={ROWS} viewerRails={viewerRails} />);

/**
 * A tester holds ONE wallet and the board is a mix. Before this, the first sign that a mission
 * needed a different wallet was the submit button refusing them — after the work was done.
 */
describe("marketplace board · mixed rails", () => {
  it("always says where a mission pays, on every row", () => {
    show();
    expect(screen.getByText("GOAT")).toBeInTheDocument();
    expect(screen.getByText("Starknet · private")).toBeInTheDocument();
  });

  it("names Arc for an Arc row — GOAT and Arc are both EVM, the rail alone cannot say which", () => {
    render(<MarketplaceBoard rows={ROWS_WITH_ARC} />);
    expect(screen.getByText("Arc")).toBeInTheDocument();
    expect(screen.getByText("GOAT")).toBeInTheDocument();
  });

  it("never warns a signed-OUT visitor — they have not chosen a wallet yet", () => {
    show();
    expect(screen.queryByText(/needs an? .* wallet/)).not.toBeInTheDocument();
  });

  it("tells an EVM tester which rows need the other wallet, and only those", () => {
    show(["evm"]);
    expect(screen.getByText("needs a Starknet wallet")).toBeInTheDocument();
    expect(screen.queryByText("needs an Ethereum wallet")).not.toBeInTheDocument();
  });

  it("mirrors it exactly for a Starknet tester", () => {
    show(["starknet"]);
    expect(screen.getByText("needs an Ethereum wallet")).toBeInTheDocument();
    expect(screen.queryByText("needs a Starknet wallet")).not.toBeInTheDocument();
  });

  it("warns a DUAL-wallet tester about nothing — the sessions are independent", () => {
    // getFounderAddress() prefers EVM whenever both cookies exist, which is right for a founder
    // and would tell this tester they need a wallet they are already holding.
    show(["evm", "starknet"]);
    expect(screen.queryByText(/needs an? .* wallet/)).not.toBeInTheDocument();
  });

  it("HIDES NOTHING — every mission stays listed and stays a link, whatever wallet you hold", () => {
    for (const rails of [undefined, ["evm"], ["starknet"], ["evm", "starknet"]] as const) {
      const { unmount } = show(rails ? [...rails] : undefined);
      expect(screen.getByText("goat-work").closest("a")).toHaveAttribute("href", "/c/c-goat-work");
      expect(screen.getByText("private-work").closest("a")).toHaveAttribute("href", "/c/c-private-work");
      unmount();
    }
  });
});
