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
vi.mock("./deploy/deploy-flow", () => ({ DeployFlow: () => <div>metis-flow</div> }));

const plan = {
  totalBudgetBase: "1000000",
  missions: [{ rewardBase: "500000", maxCompletions: 1, title: "m", missionKey: "m" }],
} as never;

const renderBar = async (jobId: string, approved: boolean) => {
  const { BudgetBar } = await import("./budget-bar");
  return render(
    <BudgetBar
      jobId={jobId}
      plan={plan}
      approval={approved ? { approvedAt: 1788000000, revision: 1, campaignIdHash: "0x1", missionPlanDigest: "0x2" } : null}
      onRevised={() => {}}
      onApproved={() => {}}
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
