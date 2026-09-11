import { describe, expect, it, vi } from "vitest";

/**
 * A CAMPAIGN LAUNCHED FROM THE FOUNDER'S ACCOUNT IS THE FOUNDER'S. The account (a Privy wallet Sage
 * holds) posts with its own address, so comparing one address locked the founder out of their own
 * console, stop button and held-work review for everything Sage launched for them.
 */
const FOUNDER = `0x${"1".repeat(40)}`;
const ACCOUNT = `0x${"a".repeat(40)}`;
const STRANGER = `0x${"9".repeat(40)}`;
vi.mock("@/lib/db/agent-wallets", () => ({
  getAgentWalletByAddress: (address: string) => (address.toLowerCase() === ACCOUNT ? { founderAddress: FOUNDER, privyWalletAddress: ACCOUNT } : null),
}));
vi.mock("@/lib/db/campaigns", () => ({ listSubmissions: () => [], listMissions: () => [], setSubmissionStatus: vi.fn(), recordEvent: vi.fn() }));

const { ownsCampaign } = await import("./review-actions");
const campaign = (posterWallet: string) => ({ id: "c", posterWallet }) as never;

describe("ownsCampaign", () => {
  it("the poster owns it", () => {
    expect(ownsCampaign(campaign(FOUNDER), FOUNDER)).toBe(true);
  });
  it("the founder behind the account that posted it owns it", () => {
    expect(ownsCampaign(campaign(ACCOUNT), FOUNDER)).toBe(true);
  });
  it("nobody else does — not a stranger, not a signed-out visitor", () => {
    expect(ownsCampaign(campaign(ACCOUNT), STRANGER)).toBe(false);
    expect(ownsCampaign(campaign(FOUNDER), STRANGER)).toBe(false);
    expect(ownsCampaign(campaign(ACCOUNT), null)).toBe(false);
  });
});
