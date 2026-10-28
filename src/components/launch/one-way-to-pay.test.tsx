import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * ONE WAY TO PAY (26 Oct 2026). A plan was funded one of two ways, asked as "public receipts, or private
 * on Starknet?", and the answer was remembered per job in the browser. Starknet is closed
 * (networks.ts CLOSED_NETWORKS), so an approved plan always funds the one way, from the account Sage keeps
 * on Metis: no question is asked, and a choice an old browser still remembers cannot route around it.
 */

const session = { address: null as string | null, chain: null as string | null, loading: false, authed: false };
vi.mock("@/lib/auth/use-founder-session", () => ({ useFounderSession: () => session }));

// The deploy flow reaches for wallets and the network; this test is about which one is SHOWN.
vi.mock("./deploy/deploy-flow", () => ({
  DeployFlow: (p: { approve?: { revision: number } }) => <div>{p.approve ? `metis-flow approving r${p.approve.revision}` : "metis-flow"}</div>,
}));

const plan = {
  totalBudgetBase: "1000000",
  revision: 2,
  missions: [{ rewardBase: "500000", maxCompletions: 2, title: "m", missionKey: "m" }],
} as never;

const renderBar = async (jobId: string, approved: boolean, launched: { campaignId: string } | null = null) => {
  const { BudgetBar } = await import("./budget-bar");
  return render(
    <BudgetBar
      jobId={jobId}
      plan={plan}
      approval={approved ? { approvedAt: 1788000000, revision: 1, campaignIdHash: "0x1", missionPlanDigest: "0x2" } : null}
      launched={launched}
      onRevised={() => {}}
    />,
  );
};

beforeEach(() => {
  window.localStorage.clear();
  session.address = null;
  session.chain = "evm";
  session.loading = false;
  session.authed = true;
});

describe("how an approved plan is funded", () => {
  it("asks nothing about how it pays: there is one way", async () => {
    await renderBar("job1", false);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/private-capable/i)).toBeNull();
    expect(screen.queryByText(/how this campaign pays/i)).toBeNull();
  });

  it("funds through the Metis flow once approved", async () => {
    await renderBar("job2", true);
    expect(await screen.findByText("metis-flow")).toBeTruthy();
  });

  it("ignores a Starknet choice an old browser still remembers", async () => {
    window.localStorage.setItem("sage.rail.job3", "starknet");
    await renderBar("job3", true);
    expect(await screen.findByText("metis-flow")).toBeTruthy();
  });

  it("does not hand a Starknet session a Starknet flow either", async () => {
    session.chain = "starknet";
    await renderBar("job4", true);
    expect(await screen.findByText("metis-flow")).toBeTruthy();
  });
});

/**
 * ONE BUTTON (28 Oct 2026): approving and launching were two buttons for one decision. A plan not yet
 * approved launches through the door, which approves the revision on screen; a launched plan says so.
 */
describe("one decision, one button", () => {
  it("a plan not yet approved has no separate approve button: launching approves the revision on screen", async () => {
    await renderBar("job5", false);
    expect(await screen.findByText("metis-flow approving r2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve mission plan/ })).toBeNull();
  });

  it("an approved plan launches without approving again", async () => {
    await renderBar("job6", true);
    expect(await screen.findByText("metis-flow")).toBeTruthy();
  });

  it("a launched plan says it is live and offers no door", async () => {
    await renderBar("job7", true, { campaignId: "gig-live" });
    expect(screen.getAllByText(/This job is live/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/metis-flow/)).toBeNull();
    expect(screen.getByRole("link", { name: /Open the job/ }).getAttribute("href")).toBe("/campaign/gig-live");
  });
});
