import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { __resetFounderSessionForTest } from "@/lib/auth/use-founder-session";

/**
 * THE PLAN PAGE NEVER SIGNS A WALLET IN (Demo Day, 10 Oct 2026; one way to launch since 26 Oct).
 *
 * The exact path that failed on stage: signed in by email, a browser wallet connected, no account door
 * in view. The page offered "Secure plan ownership", which signed the browser wallet in over the email
 * session and lost the account. The page then explained instead; since 26 Oct it has nothing that signs
 * in at all. Whoever is signed in launches from their account on Metis, and nobody signed in is sent to
 * the sign-in (email or MetaMask), never asked for a wallet signature here.
 */
const h = vi.hoisted(() => ({
  wallet: null as string | null,
  session: null as string | null,
  signIn: vi.fn(async () => false),
}));

vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({
    address: h.wallet, available: true, chainId: 1088, connecting: false, onMetis: true,
    onChain: (id: number) => id === 1088, connect: vi.fn(), disconnect: vi.fn(), switchToMetis: vi.fn(),
    switchToChain: vi.fn(), getWalletClient: () => null, getProvider: () => null,
  }),
}));
vi.mock("@/lib/auth/use-siwe", () => ({
  useSiwe: () => ({
    address: h.wallet, authedAddress: h.session,
    authed: !!h.session && !!h.wallet && h.session.toLowerCase() === h.wallet.toLowerCase(),
    available: true, chainId: 1088, onMetis: true, onChain: (id: number) => id === 1088, connecting: false,
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
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function serve() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/auth/founder") return json({ address: h.session, chain: h.session ? "evm" : null });
    if (u === "/api/auth/session") return json({ address: h.session });
    if (u.startsWith("/api/treasury")) {
      // signed in without an account yet: the door opens one; signed out: the endpoint refuses
      return h.session ? json({ linked: false, available: true, chainId: 1088, network: "Metis", accounts: [] }) : json({ error: "Sign in first." }, 401);
    }
    return json({ ok: false });
  }));
}

beforeEach(() => {
  __resetFounderSessionForTest();
  h.signIn.mockClear();
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => vi.unstubAllGlobals());

const noWalletSignIn = () => {
  expect(screen.queryByRole("button", { name: /Secure plan ownership/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Connect your wallet/ })).toBeNull();
  expect(h.signIn).not.toHaveBeenCalled();
};

describe("the plan page and who is signed in", () => {
  it("signed in by email with a browser wallet connected: the account, and nothing that signs the wallet in", async () => {
    h.session = EMAIL_ACCOUNT;
    h.wallet = BROWSER_WALLET;
    serve();
    render(<DeployFlow jobId="j" plan={plan} />);
    expect(await screen.findByRole("button", { name: "Open your account on Metis" })).toBeTruthy();
    noWalletSignIn();
  });

  it("signed in with MetaMask: the very same door as an email sign-in", async () => {
    h.session = BROWSER_WALLET;
    h.wallet = BROWSER_WALLET;
    serve();
    render(<DeployFlow jobId="j" plan={plan} />);
    expect(await screen.findByRole("button", { name: "Open your account on Metis" })).toBeTruthy();
    noWalletSignIn();
  });

  it("nobody signed in: sent to the sign-in, never asked for a wallet signature here", async () => {
    h.session = null;
    h.wallet = BROWSER_WALLET;
    serve();
    render(<DeployFlow jobId="j" plan={plan} />);
    expect(await screen.findByRole("button", { name: "Sign in to launch" })).toBeTruthy();
    noWalletSignIn();
  });
});
