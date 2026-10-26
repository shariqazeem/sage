import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * THE ACCOUNT DOOR IS HOW A PLAN LAUNCHES — THE ONLY WAY (26 Oct 2026).
 *
 * On Demo Day (10 Oct) a founder signed in by email had $5 in the account; the door was a small button
 * and a wallet route below it a big "Connect your wallet". The big one got clicked, a browser wallet
 * signed in over the email session, and the account vanished mid-demo. The door became the main button.
 * Since 26 Oct it is the only one: an email and a MetaMask sign-in launch the same way, from the account
 * Sage keeps on Metis, and an account on a paused (GOAT) or closed (Arc) network launches nothing here.
 */
vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({
    address: null, available: true, chainId: null, connecting: false, onMetis: false,
    onChain: () => false, connect: vi.fn(), switchToMetis: vi.fn(), switchToChain: vi.fn(), getWalletClient: () => null,
  }),
}));

import { DeployFlow } from "./deploy-flow";
import { TreasuryLaunch } from "./treasury-launch";
import type { PlanView } from "../types";

const plan: PlanView = {
  publicCampaignId: "gig-test", campaignKind: "gig", visibility: "unlisted", campaignIdHash: `0x${"1".repeat(64)}`,
  missionPlanDigest: `0x${"2".repeat(64)}`, missions: [], totalBudgetBase: "1010000", allocatedBase: "1010000", tokenDecimals: 6, revision: 1,
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const METIS_ACCOUNT = { chainId: 1088, network: "Metis", address: "0xacc", isMainnet: true };
const METIS = { linked: true, available: true, chainId: 1088, network: "Metis", address: "0xacc", balanceUsd: 5, perCampaignCapUsd: 50, isMainnet: true, enoughGas: true, nativeSymbol: "METIS", accounts: [METIS_ACCOUNT] };
const NONE = { linked: false, available: true, chainId: 1088, network: "Metis", accounts: [] };
const ARC = { linked: true, available: true, chainId: 5042, network: "Arc", address: "0xf865", balanceUsd: 5, perCampaignCapUsd: 50, isMainnet: true, enoughGas: true };
const GOAT = { linked: true, available: true, chainId: 2345, network: "GOAT Network", address: "0x60a7", balanceUsd: 5, perCampaignCapUsd: 50, isMainnet: true, enoughGas: true };

/** The account endpoint: `first` answers the default (Metis) read; other chains answer from `byChain`. */
function routes(first: unknown, byChain: Record<number, unknown> = {}, opts: { failFirst?: boolean } = {}) {
  let reads = 0;
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/treasury") {
      reads++;
      if (opts.failFirst && reads === 1) throw new TypeError("Failed to fetch"); // a dropped connection
      return json(first);
    }
    const m = /^\/api\/treasury\?chainId=(\d+)$/.exec(u);
    if (m && byChain[Number(m[1])]) return json(byChain[Number(m[1])]);
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
    vi.stubGlobal("fetch", routes(METIS));
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    expect(screen.getByText(/Checking your account/)).toBeTruthy();
    const go = await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ });
    expect(go.className).toContain("lx-btn");
    expect(go).toHaveProperty("disabled", false);
  });

  it("retries a failed read once, so a dropped connection does not hide the account", async () => {
    vi.stubGlobal("fetch", routes(METIS, {}, { failFirst: true }));
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    expect(await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ }, { timeout: 4000 })).toBeTruthy();
  });

  it("gives no door to an account on a paused or closed network: GOAT and Arc launch nothing here", async () => {
    const held = { ...METIS, accounts: [METIS_ACCOUNT, { chainId: 2345, network: "GOAT Network", address: "0x60a7", isMainnet: true }, { chainId: 5042, network: "Arc", address: "0xf865", isMainnet: true }] };
    const fetchHeld = routes(held, { 2345: GOAT, 5042: ARC });
    vi.stubGlobal("fetch", fetchHeld);
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ });
    expect(screen.queryByText(/on Arc/)).toBeNull();
    expect(screen.queryByText(/on GOAT/)).toBeNull();
    // not even read: a closed network's balance has no door to decide
    expect(fetchHeld.mock.calls.map((c) => String(c[0]))).toEqual(["/api/treasury"]);
  });

  it("without an account, opens one right here, then offers the launch", async () => {
    let opened = false;
    const fetchOpen = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/treasury" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ perCampaignCapUsd: 50, chainId: 1088 });
        opened = true;
        return json({ linked: true });
      }
      if (u === "/api/treasury") return json(opened ? METIS : NONE);
      return json({ ok: false });
    });
    vi.stubGlobal("fetch", fetchOpen);
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open your account on Metis" }));
    expect(await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ })).toBeTruthy();
  });

  it("prefills the new account's per-job limit to at least this job's budget", async () => {
    vi.stubGlobal("fetch", routes(NONE));
    render(<TreasuryLaunch jobId="j" budgetUsd={120.5} />);
    expect(((await screen.findByLabelText("Most per job, in USDC")) as HTMLInputElement).value).toBe("121");
  });

  it("signed out, it asks for a sign-in, never a wallet connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Sign in first." }, 401)));
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    expect(await screen.findByRole("button", { name: "Sign in to launch" })).toBeTruthy();
    expect(screen.getByText(/your email or MetaMask/)).toBeTruthy();
  });

  it("an account whose per-job limit is below the plan says so before the click", async () => {
    vi.stubGlobal("fetch", routes({ ...METIS, balanceUsd: 500, perCampaignCapUsd: 50 }));
    render(<TreasuryLaunch jobId="j" budgetUsd={100} />);
    expect(await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/at most \$50\.00 into one job/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change the limit" }).getAttribute("href")).toBe("/workspace/account?chain=1088");
  });

  it("an account short of the budget says how much to add, and launches nothing until it has it", async () => {
    vi.stubGlobal("fetch", routes({ ...METIS, balanceUsd: 0.09 }));
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    expect(await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Add \$0\.92 or more to your account/)).toBeTruthy();
    expect(screen.queryByText(/from your wallet/)).toBeNull();
  });
});

describe("the plan page", () => {
  it("never starts a browser-wallet route, with an account or without one", async () => {
    for (const first of [METIS, NONE, { ...METIS, balanceUsd: 0.09 }]) {
      vi.stubGlobal("fetch", routes(first));
      const { unmount } = render(<DeployFlow jobId="j" plan={plan} />);
      await screen.findByText(/Launch it from your account/);
      await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$|Open your account on Metis/ });
      expect(screen.queryByRole("button", { name: /Connect your wallet/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /browser wallet/ })).toBeNull();
      expect(screen.queryByText(/Wallet ownership/)).toBeNull();
      unmount();
    }
  });
});

describe("a plan's limit on the account launch", () => {
  it("says why, in words, and opens the checkout on the plan that lifts it", async () => {
    const fetchLimited = vi.fn(async (url: string) => {
      const u = String(url);
      if (u === "/api/treasury") return json(METIS);
      if (u === "/api/launch/j/treasury")
        return new Response(JSON.stringify({ ok: false, reason: "plan_limit", error: "Free runs one live job at a time, and you have 1 live.", upgradeTo: "pro" }), { status: 402, headers: { "content-type": "application/json" } });
      return json({ ok: false });
    });
    vi.stubGlobal("fetch", fetchLimited);
    render(<TreasuryLaunch jobId="j" budgetUsd={1.01} />);
    await userEvent.click(await screen.findByRole("button", { name: /Let Sage launch it from your account on Metis$/ }));
    expect(await screen.findByText(/Free runs one live job at a time/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade to Pro" }).getAttribute("href")).toBe("/checkout?plan=pro");
  });
});
