import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * POST, HANDED OVER (28 Oct 2026). The founder: "pay for work looks so packed", and "simple type to agent
 * got too common that no one uses". Pay for work takes what the founder already has (a link Sage opens,
 * or the message they'd send someone), and gives back the job as one card: what it pays and who can do
 * it are taps, and one button launches it from the account. Test my product is one step.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const session = { address: "0xF0000000000000000000000000000000000000f0", chain: "evm", loading: false, authed: true, refresh: vi.fn() };
vi.mock("@/lib/auth/use-founder-session", () => ({ useFounderSession: () => session }));
vi.mock("@/lib/auth/use-siwe", () => ({ useSiwe: () => ({ connecting: false, signingIn: false, authed: true }) }));
vi.mock("@/components/wallet/founder-sign-in", () => ({ FounderSignIn: () => <div>sign-in-panel</div> }));

import { LaunchForm } from "./launch-form";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ACCOUNT = { linked: true, available: true, chainId: 1088, network: "Metis", balanceUsd: 80, perCampaignCapUsd: 100, enoughGas: true, nativeSymbol: "METIS", canSwap: true, gasWei: "60000000000000000", launchFloorWei: "50000000000000000" };
const ISSUE = "https://github.com/acme/app/issues/42";
const DRAFT = {
  kind: "gig",
  title: "Fix the crash on PDF uploads over 10 MB",
  who: "anyone",
  slots: 1,
  milestones: [
    {
      title: "Fix the crash",
      deliverable: "the crash on PDF uploads over 10 MB is fixed in a public pull request",
      instructions: "1. Reproduce it with a 12 MB PDF.\n2. Fix it and add a test.\n3. Submit the link to your pull request.",
      criteria: ["The pull request fixes the crash described in #42", "It adds a test with a file over 10 MB"],
      evidence: { kind: "artifact_url", allowedHosts: [] },
      effortMinutes: 120,
    },
  ],
};
const READ = { url: ISSUE, label: "github.com/acme/app/issues/42", read: true, reason: null };

function routes(opts: { account?: unknown; draft?: unknown; draftStatus?: number } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/launch/starters") return json({ ok: true, product: { name: "Sage", url: "https://sagepays.xyz" }, canInvite: true });
    if (u === "/api/treasury") return json(opts.account ?? ACCOUNT);
    if (u === "/api/campaigns/direct/draft") return json(opts.draft ?? { ok: true, draft: DRAFT, notes: [], source: READ }, opts.draftStatus ?? 200);
    if (u === "/api/campaigns/direct" && init?.method === "POST") return json({ ok: true, jobId: "job1", planUrl: "https://sagepays.xyz/launch/job1" });
    if (u === "/api/launch/job1/treasury" && init?.method === "POST") return json({ campaignId: "gig-x", url: "/c/gig-x", steps: [] });
    if (u === "/api/launch" && init?.method === "POST") return json({ ok: true, job: { id: "insp1" } });
    return json({ ok: false }, 404);
  });
}
const bodyOf = (f: ReturnType<typeof routes>, url: string) => {
  const call = f.mock.calls.find((c) => String(c[0]) === url && (c[1] as RequestInit | undefined)?.method === "POST");
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
};
const handOver = async (text: string) => {
  await userEvent.type(await screen.findByLabelText(/Paste a link, or the message/), text);
  await userEvent.click(screen.getByRole("button", { name: "Hand it to Sage" }));
};

beforeEach(() => {
  push.mockReset();
  session.authed = true;
  window.history.pushState({}, "", "/launch?do=pay");
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => vi.unstubAllGlobals());

describe("Pay for work, handed over", () => {
  it("opens with one box, not a form", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    expect(await screen.findByLabelText(/Paste a link, or the message you'd send someone/)).toBeTruthy();
    expect(screen.queryByText("Who is this for")).toBeNull();
    expect(screen.queryByText("How Sage verifies")).toBeNull();
  });

  it("reads the link, gives the job back as one card, and launches it with a tap and a click", async () => {
    const f = routes();
    vi.stubGlobal("fetch", f);
    render(<LaunchForm />);
    await handOver(ISSUE);
    expect(await screen.findByText(/Opened github.com\/acme\/app\/issues\/42/)).toBeTruthy();
    expect(screen.getByText(/Wrote the job and what it checks/)).toBeTruthy();
    expect(screen.getByText("Fix the crash on PDF uploads over 10 MB")).toBeTruthy();
    expect(screen.getByText("Set what it pays.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Launch" })).toHaveProperty("disabled", true);

    await userEvent.click(screen.getByRole("button", { name: "$50" }));
    await userEvent.click(await screen.findByRole("button", { name: "Launch · $50.00 from your account" }));
    expect(await screen.findByText(/It's live\./)).toBeTruthy();
    expect(bodyOf(f, "/api/campaigns/direct/draft")).toEqual({ intent: ISSUE });
    expect(bodyOf(f, "/api/campaigns/direct")).toMatchObject({ kind: "gig", title: "Fix the crash on PDF uploads over 10 MB", milestones: [{ rewardUsd: 50, slots: 1 }] });
    expect(bodyOf(f, "/api/launch/job1/treasury")).toEqual({ chainId: 1088 });
    expect(push).not.toHaveBeenCalled();
  });

  it("takes money and headcount from the founder's words, never from the link", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    await handOver(`Pay $20 to fix ${ISSUE}`);
    expect((await screen.findByRole("button", { name: "$20" })).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/A gig for one person/)).toBeTruthy();
  });

  it("offers a product test for a front page handed over alone", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    await handOver("https://sagepays.xyz");
    await userEvent.click(await screen.findByRole("button", { name: "Have people try it" }));
    expect(((await screen.findByPlaceholderText("https://yourproduct.com")) as HTMLInputElement).value).toBe("https://sagepays.xyz/");
  });

  it("says plainly when it could not open the link, and asks for the words", async () => {
    vi.stubGlobal("fetch", routes({ draft: { ok: false, error: "Sage couldn't open acme.com/brief: the page wasn't found. Paste what it says, or describe the work in a few words.", source: { url: "https://acme.com/brief", label: "acme.com/brief", read: false, reason: "the page wasn't found" } }, draftStatus: 422 }));
    render(<LaunchForm />);
    await handOver("https://acme.com/brief");
    expect(await screen.findByText(/Couldn't open acme.com\/brief: the page wasn't found\./)).toBeTruthy();
    expect(screen.getByText(/Paste what it says, or describe the work in a few words/)).toBeTruthy();
  });

  it("starts work for someone the founder names as theirs to invite", async () => {
    vi.stubGlobal("fetch", routes({ draft: { ok: true, draft: { ...DRAFT, who: "my designer" }, notes: [], source: null } }));
    render(<LaunchForm />);
    await handOver("Pay my designer $50 when the new landing page is live");
    expect((await screen.findByRole("button", { name: "People I invite" })).getAttribute("aria-pressed")).toBe("true");
  });

  it("an account short of the job says how much to add, and saves the plan instead of launching", async () => {
    const f = routes({ account: { ...ACCOUNT, balanceUsd: 3.39 } });
    vi.stubGlobal("fetch", f);
    render(<LaunchForm />);
    await handOver(ISSUE);
    await userEvent.click(await screen.findByRole("button", { name: "$50" }));
    expect(await screen.findByText(/Your account holds \$3\.39\. Add \$46\.61 to launch this/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create the gig" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/launch/job1"));
    expect(f.mock.calls.some((c) => String(c[0]).endsWith("/treasury") && (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("signed out, handing over asks for a sign-in", async () => {
    session.authed = false;
    vi.stubGlobal("fetch", routes({ draft: { ok: false, error: "Sign in" }, draftStatus: 401 }));
    render(<LaunchForm />);
    await handOver(ISSUE);
    expect(await screen.findByText("sign-in-panel")).toBeTruthy();
  });

  it("keeps the full form one click away", async () => {
    vi.stubGlobal("fetch", routes());
    render(<LaunchForm />);
    await handOver(ISSUE);
    await userEvent.click(await screen.findByRole("button", { name: "Change the details" }));
    expect(screen.getByText("How Sage verifies")).toBeTruthy();
  });
});

describe("Test my product, one step", () => {
  it("takes the product Sage last tested and a budget, then lets Sage look", async () => {
    window.history.pushState({}, "", "/launch");
    const f = routes();
    vi.stubGlobal("fetch", f);
    render(<LaunchForm />);
    await waitFor(() => expect(((screen.getByPlaceholderText("https://yourproduct.com")) as HTMLInputElement).value).toBe("https://sagepays.xyz"));
    await userEvent.click(screen.getByRole("button", { name: "$10" }));
    await userEvent.click(screen.getByRole("button", { name: /Let Sage look at it/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/launch/insp1"));
    expect(bodyOf(f, "/api/launch")).toMatchObject({ productUrl: "https://sagepays.xyz", budgetUsd: "10" });
  });
});
