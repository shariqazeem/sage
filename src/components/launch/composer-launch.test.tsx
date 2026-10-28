import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * POST, WITHOUT THE CHORE (28 Oct 2026). The founder: "im lazy to think what to launch … the way it has
 * steps to launch it, that whole flow feels boring and manual". Post now opens with whole jobs written for
 * their product, and the composer's own button launches the job from the account: one tap to fill, one to
 * launch. When the account cannot pay yet, it says what is missing and the plan is saved for later.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const session = { address: "0xF0000000000000000000000000000000000000f0", chain: "evm", loading: false, authed: true, refresh: vi.fn() };
vi.mock("@/lib/auth/use-founder-session", () => ({ useFounderSession: () => session }));
vi.mock("@/lib/auth/use-siwe", () => ({ useSiwe: () => ({ connecting: false, signingIn: false, authed: true }) }));
vi.mock("@/components/wallet/founder-sign-in", () => ({ FounderSignIn: () => <div>sign-in-panel</div> }));

import { LaunchForm } from "./launch-form";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ACCOUNT = { linked: true, available: true, chainId: 1088, network: "Metis", balanceUsd: 20, perCampaignCapUsd: 50, enoughGas: true, nativeSymbol: "METIS", canSwap: true, gasWei: "60000000000000000", launchFloorWei: "50000000000000000" };

function routes(account: unknown = ACCOUNT) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/launch/starters") return json({ ok: true, product: { name: "Sage", url: "https://sagepays.xyz" } });
    if (u === "/api/treasury") return json(account);
    if (u === "/api/campaigns/direct" && init?.method === "POST") return json({ ok: true, jobId: "job1", planUrl: "https://sagepays.xyz/launch/job1" });
    if (u === "/api/launch/job1/treasury" && init?.method === "POST") return json({ campaignId: "gig-x", url: "/c/gig-x", steps: [] });
    return json({ ok: false }, 404);
  });
}
const bodyOf = (f: ReturnType<typeof routes>, url: string) => {
  const call = f.mock.calls.find((c) => String(c[0]) === url && (c[1] as RequestInit | undefined)?.method === "POST");
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
};

beforeEach(() => {
  push.mockReset();
  session.authed = true;
  window.history.pushState({}, "", "/launch?do=pay");
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => vi.unstubAllGlobals());

describe("Post's composer", () => {
  it("opens with ready jobs for the founder's own product", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    expect(await screen.findByRole("button", { name: /Have people try Sage/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /A getting-started guide/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /First users on-chain/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /A builder grant/ })).toBeTruthy();
  });

  it("one tap fills the job, and one click launches it from the account", async () => {
    const f = routes();
    vi.stubGlobal("fetch", f);
    render(<LaunchForm />);
    await userEvent.click(await screen.findByRole("button", { name: /A getting-started guide/ }));
    const go = await screen.findByRole("button", { name: /Launch · \$10\.00 from your account/ });
    await userEvent.click(go);
    expect(await screen.findByText(/It's live\./)).toBeTruthy();
    const plan = bodyOf(f, "/api/campaigns/direct");
    expect(plan).toMatchObject({ kind: "gig", milestones: [{ rewardUsd: 10, slots: 1, evidence: { kind: "artifact_url", minWords: 300 } }] });
    expect(bodyOf(f, "/api/launch/job1/treasury")).toEqual({ chainId: 1088 });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Open the job/ }).getAttribute("href")).toBe("/campaign/gig-x");
  });

  it("an account short of the job says how much to add, and saves the plan instead of launching", async () => {
    const f = routes({ ...ACCOUNT, balanceUsd: 3.39 });
    vi.stubGlobal("fetch", f);
    render(<LaunchForm />);
    await userEvent.click(await screen.findByRole("button", { name: /A getting-started guide/ }));
    expect(await screen.findByText(/Your account holds \$3\.39\. Add \$6\.61 to launch this/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Create the gig/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/launch/job1"));
    expect(f.mock.calls.some((c) => String(c[0]).endsWith("/treasury") && (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("a job that needs the founder's contract says so, and waits for it", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    await userEvent.click(await screen.findByRole("button", { name: /First users on-chain/ }));
    expect(await screen.findByText("Add the contract address the transaction must go to.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Launch · \$6\.00 from your account/ })).toHaveProperty("disabled", true);
  });

  it("the product test card starts a test of the founder's product from first impressions", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    await userEvent.click(await screen.findByRole("button", { name: /Have people try Sage/ }));
    expect(((await screen.findByPlaceholderText("https://yourproduct.com")) as HTMLInputElement).value).toBe("https://sagepays.xyz");
    expect(screen.getByDisplayValue(/Can a first-time visitor understand what this product does/)).toBeTruthy();
  });

  it("signed out, the button asks for a sign-in and moves nothing", async () => {
    session.authed = false;
    const f = routes();
    vi.stubGlobal("fetch", f);
    render(<LaunchForm />);
    await userEvent.click(await screen.findByRole("button", { name: /A getting-started guide/ }));
    await userEvent.click(screen.getByRole("button", { name: /Sign in to launch/ }));
    expect(await screen.findByText("sign-in-panel")).toBeTruthy();
    expect(bodyOf(f, "/api/campaigns/direct")).toBeNull();
  });
});
