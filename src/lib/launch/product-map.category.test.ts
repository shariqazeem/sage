import { describe, expect, it } from "vitest";
import { inferCategory } from "./product-map";

const obs = (title: string, headings: string[], tech: string[] = []) =>
  [{ url: "https://x.example", title, headings, techHints: tech }] as never;

/**
 * Measured on the 2 Sep P-GEN run: tailwindcss.com/docs and plausible.io both came back
 * "web3 / crypto" — a bare `token` in the hint regex matched "design tokens" and "API token".
 * The label frames the product for the mission brain, so a docs site must read as docs.
 */
describe("inferCategory — no bare 'token'", () => {
  it("a docs site talking about design tokens is a docs site", () => {
    expect(inferCategory(obs("Installing Tailwind CSS with Vite", ["Design tokens", "Core concepts", "Documentation"]))).toBe("developer tool / docs");
  });
  it("an analytics product with an API token is not crypto", () => {
    expect(inferCategory(obs("Plausible Analytics", ["Simple analytics dashboard", "Pricing", "Generate an API token"]))).not.toBe("web3 / crypto");
  });
  it("a real DeFi product still reads as web3", () => {
    expect(inferCategory(obs("Swap on-chain", ["Connect your wallet", "DeFi liquidity pools"]))).toBe("web3 / crypto");
  });
  it("'tokenomics' is crypto; 'token' alone is not", () => {
    expect(inferCategory(obs("Project", ["Tokenomics and airdrop"]))).toBe("web3 / crypto");
    expect(inferCategory(obs("Project", ["Refresh your access token"]))).not.toBe("web3 / crypto");
  });
});
