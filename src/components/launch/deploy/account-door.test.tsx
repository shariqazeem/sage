import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * THE ACCOUNT DOOR IS THE PLAN PAGE'S MAIN BUTTON (Demo Day, 10 Oct 2026).
 *
 * On stage a founder signed in by email had $5 in the account. The door was a small button and the
 * wallet route below it a big "Connect your wallet"; the big one got clicked, a browser wallet
 * signed in over the email session, and the account vanished from the page mid-demo. With an
 * account that can launch, the page now offers ONE big button, and the wallet route sits behind a
 * small link with a warning about what it does to the sign-in.
 */
vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({
    address: null, available: true, chainId: null, connecting: false, onMetis: false,
    onChain: () => false, connect: vi.fn(), switchToMetis: vi.fn(), switchToChain: vi.fn(), getWalletClient: () => null,
  }),
}));
vi.mock("@/lib/auth/use-siwe", () => ({
  useSiwe: () => ({
    address: null, authedAddress: null, authed: false, available: true, chainId: null, onMetis: false,
    onChain: () => false, connecting: false, signingIn: false, connect: vi.fn(), switchToMetis: vi.fn(),
    switchToChain: vi.fn(), refresh: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
  }),
}));

import { DeployFlow } from "./deploy-flow";
import { TreasuryLaunch } from "./treasury-launch";
import type { PlanView } from "../types";

const plan: PlanView = {
  publicCampaignId: "gig-test", campaignKind: "gig", visibility: "unlisted", campaignIdHash: `0x${"1".repeat(64)}`,
  missionPlanDigest: `0x${"2".repeat(64)}`, missions: [], totalBudgetBase: "1010000", allocatedBase: "1010000", tokenDecimals: 6, revision: 1,
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const NO_GOAT = { linked: false, available: true, chainId: 2345, network: "GOAT Network", accounts: [{ chainId: 5042, network: "Arc", address: "0xf865", isMainnet: true }] };
const ARC = { linked: true, available: true, chainId: 5042, network: "Arc", address: "0xf865", balanceUsd: 5, perCampaignCapUsd: 50, isMainnet: true, enoughGas: true };

function routes(opts: { failFirst?: boolean; noAccount?: boolean } = {}) {
  let calls = 0;
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/treasury") {
      calls++;
      if (opts.failFirst && calls === 1) throw new TypeError("Failed to fetch"); // a dropped connection
      return json(opts.noAccount ? { ...NO_GOAT, accounts: [] } : NO_GOAT);
    }
    if (u.startsWith("/api/treasury?chainId=5042")) return json(ARC);
    return json({ ok: false });
  });
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the account door", () => {
  it("says it is checking instead of rendering nothing, then offers the launch as a full-size button", async () => {
    vi.stubGlobal("fetch", routes());
    const onState = vi.fn();
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} onState={onState} />);
    expect(screen.getByText(/Checking your account/)).toBeTruthy();
    const go = await screen.findByRole("button", { name: /Let Sage launch it from your account on Arc$/ });
    expect(go.className).toContain("lx-btn");
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({ loading: false, hasDoor: true }));
  });

  it("retries a failed read once, so a dropped connection does not hide the account", async () => {
    vi.stubGlobal("fetch", routes({ failFirst: true }));
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    expect(await screen.findByRole("button", { name: /Let Sage launch it from your account on Arc$/ }, { timeout: 4000 })).toBeTruthy();
  });
});

describe("the plan page with an account", () => {
  it("offers ONE main button: the account's, with the wallet route folded behind a link", async () => {
    vi.stubGlobal("fetch", routes());
    render(<DeployFlow jobId="j" plan={plan} launchChains={[2345, 5042]} />);
    await screen.findByRole("button", { name: /Let Sage launch it from your account on Arc$/ });
    expect(screen.queryByRole("button", { name: /Connect your wallet/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Or fund it from a browser wallet instead/ }));
    expect(screen.getByRole("button", { name: /Connect your wallet/ })).toBeTruthy();
    expect(screen.getByText(/stays with the sign-in you used/)).toBeTruthy();
  });

  it("without an account the wallet route is the page, as before", async () => {
    vi.stubGlobal("fetch", routes({ noAccount: true }));
    render(<DeployFlow jobId="j" plan={plan} launchChains={[2345, 5042]} />);
    expect(await screen.findByRole("button", { name: /Connect your wallet/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Or fund it from a browser wallet instead/ })).toBeNull();
  });
});
