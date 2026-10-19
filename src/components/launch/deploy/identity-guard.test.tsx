import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { __resetFounderSessionForTest } from "@/lib/auth/use-founder-session";

/**
 * THE PLAN PAGE NEVER SIGNS A DIFFERENT WALLET IN OVER THE FOUNDER (Demo Day, 10 Oct 2026).
 *
 * The exact path that failed on stage: signed in by email, a browser wallet connected, no account
 * door in view. The page offered "Secure plan ownership", which signed the browser wallet in over
 * the email session and lost the account. It now explains instead, and offers nothing that signs in.
 */
const h = vi.hoisted(() => ({
  wallet: null as string | null,
  session: null as string | null,
  signIn: vi.fn(async () => false),
}));

vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({
    address: h.wallet, available: true, chainId: 2345, connecting: false, onMetis: false,
    onChain: (id: number) => id === 2345, connect: vi.fn(), disconnect: vi.fn(), switchToMetis: vi.fn(),
    switchToChain: vi.fn(), getWalletClient: () => null, getProvider: () => null,
  }),
}));
vi.mock("@/lib/auth/use-siwe", () => ({
  useSiwe: () => ({
    address: h.wallet, authedAddress: h.session,
    authed: !!h.session && !!h.wallet && h.session.toLowerCase() === h.wallet.toLowerCase(),
    available: true, chainId: 2345, onMetis: false, onChain: (id: number) => id === 2345, connecting: false,
    signingIn: false, conflict: null, connect: vi.fn(), switchToMetis: vi.fn(), switchToChain: vi.fn(),
    refresh: vi.fn(), signIn: h.signIn, signOut: vi.fn(),
  }),
}));

import { DeployFlow } from "./deploy-flow";
import type { PlanView } from "../types";

const EMAIL_ACCOUNT = "0x1111111111111111111111111111111111111111";
const BROWSER_WALLET = "0x2222222222222222222222222222222222222222";

const plan: PlanView = {
  publicCampaignId: "gig-test", campaignKind: "gig", visibility: "unlisted", campaignIdHash: `0x${"1".repeat(64)}`,
  missionPlanDigest: `0x${"2".repeat(64)}`, missions: [], totalBudgetBase: "1010000", allocatedBase: "1010000", tokenDecimals: 6, revision: 1,
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

function serve() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/auth/founder") return json({ address: h.session, chain: h.session ? "evm" : null });
    if (u === "/api/auth/session") return json({ address: h.session });
    // no account on any network: the wallet route is the whole page, as it was on stage
    if (u.startsWith("/api/treasury")) return json({ linked: false, available: true, chainId: 2345, network: "GOAT Network", accounts: [] });
    return json({ ok: false });
  }));
}

beforeEach(() => {
  __resetFounderSessionForTest();
  h.signIn.mockClear();
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => vi.unstubAllGlobals());

describe("the plan page and who is signed in", () => {
  it("signed in by email with a browser wallet connected: explains, offers no sign-in, signs nothing", async () => {
    h.session = EMAIL_ACCOUNT;
    h.wallet = BROWSER_WALLET;
    serve();
    render(<DeployFlow jobId="j" plan={plan} launchChains={[2345]} />);
    expect(await screen.findByText(/this plan belongs to that account/)).toBeTruthy();
    expect(screen.getByText(/0x222222…222222/)).toBeTruthy(); // names the wallet that can't launch it
    expect(screen.queryByRole("button", { name: /Secure plan ownership/ })).toBeNull();
    expect(screen.getByRole("link", { name: /open your account/ }).getAttribute("href")).toBe("/workspace/account");
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("signed in with the wallet that is connected: the claim is offered as before", async () => {
    h.session = BROWSER_WALLET;
    h.wallet = BROWSER_WALLET;
    serve();
    render(<DeployFlow jobId="j" plan={plan} launchChains={[2345]} />);
    expect(await screen.findByRole("button", { name: /Secure plan ownership/ })).toBeTruthy();
    expect(screen.queryByText(/this plan belongs to that account/)).toBeNull();
  });

  it("nobody signed in yet: the wallet signs in as the founder, as before", async () => {
    h.session = null;
    h.wallet = BROWSER_WALLET;
    serve();
    render(<DeployFlow jobId="j" plan={plan} launchChains={[2345]} />);
    expect(await screen.findByRole("button", { name: /Secure plan ownership/ })).toBeTruthy();
  });
});
