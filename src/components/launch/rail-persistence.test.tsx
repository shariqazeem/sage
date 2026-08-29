import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * THE RAIL CHOICE MUST SURVIVE A RELOAD, AND MUST NOT DEFAULT TO A DEAD END.
 *
 * It was plain component state initialised to "evm". A founder signed in with a Starknet wallet
 * chose Private-capable, reloaded, and was silently returned to the EVM flow — which then told
 * them to install MetaMask. Nothing said their choice had been discarded.
 */

const session = { address: null as string | null, chain: null as string | null, loading: false, authed: false };
vi.mock("@/lib/auth/use-founder-session", () => ({ useFounderSession: () => session }));

// The deploy flows reach for wallets and the network; this test is about which one is CHOSEN.
vi.mock("./deploy/deploy-flow", () => ({ DeployFlow: () => <div>evm-flow</div> }));
vi.mock("./deploy/starknet-deploy-flow", () => ({
  StarknetDeployFlow: () => <div>starknet-flow</div>,
}));

const plan = {
  totalBudgetBase: "1000000",
  missions: [{ rewardBase: "500000", maxCompletions: 1, title: "m", missionKey: "m" }],
} as never;

const renderBarUnapproved = async (jobId: string) => {
  const { BudgetBar } = await import("./budget-bar");
  return render(
    <BudgetBar jobId={jobId} plan={plan} approval={null} onRevised={() => {}} onApproved={() => {}} />,
  );
};

const renderBar = async (jobId: string) => {
  const { BudgetBar } = await import("./budget-bar");
  return render(
    <BudgetBar
      jobId={jobId}
      plan={plan}
      approval={{ approvedAt: 1788000000, revision: 1, campaignIdHash: "0x1", missionPlanDigest: "0x2" }}
      onRevised={() => {}}
      onApproved={() => {}}
    />,
  );
};

beforeEach(() => {
  window.localStorage.clear();
  session.address = null;
  session.chain = null;
  session.loading = false;
  session.authed = false;
});

describe("which settlement rail a founder lands on", () => {
  it("defaults an EVM founder to public receipts, as before", async () => {
    session.chain = "evm";
    session.authed = true;
    await renderBar("job1");
    expect(await screen.findByText("evm-flow")).toBeTruthy();
  });

  it("defaults a STARKNET founder to the Starknet rail — they have no EVM wallet", async () => {
    // The reported dead end: defaulted to EVM, then told to install MetaMask.
    session.chain = "starknet";
    session.authed = true;
    await renderBar("job2");
    expect(await screen.findByText("starknet-flow")).toBeTruthy();
  });

  it("remembers an explicit choice across a reload", async () => {
    window.localStorage.setItem("sage.rail.job3", "starknet");
    session.chain = "evm"; // the default would be evm; the stored choice must win
    session.authed = true;
    await renderBar("job3");
    expect(await screen.findByText("starknet-flow")).toBeTruthy();
  });

  it("keeps the choice per campaign, not globally", async () => {
    window.localStorage.setItem("sage.rail.job4", "starknet");
    session.chain = "evm";
    session.authed = true;
    await renderBar("job5"); // a DIFFERENT job
    expect(await screen.findByText("evm-flow")).toBeTruthy();
  });

  it("ignores a corrupted stored value rather than trusting it", async () => {
    window.localStorage.setItem("sage.rail.job6", "dogecoin");
    session.chain = "evm";
    session.authed = true;
    await renderBar("job6");
    expect(await screen.findByText("evm-flow")).toBeTruthy();
  });
});

describe("saving the choice", () => {
  it("writes the founder's pick, so the next page load honours it", async () => {
    // Seeding localStorage proves it is READ. This proves it is WRITTEN — without it, a founder
    // could pick Private-capable, reload, and silently land back on the EVM flow.
    const { default: userEvent } = await import("@testing-library/user-event");
    session.chain = "evm";
    session.authed = true;
    // BEFORE approval — the control is deliberately frozen afterwards, which is precisely why the
    // choice must be written the moment it is made.
    await renderBarUnapproved("job7");

    const radios = screen.getAllByRole("radio");
    const privateOption = radios.find((r) => /private/i.test(r.textContent ?? ""));
    expect(privateOption, "the Private-capable option should exist").toBeTruthy();
    await userEvent.click(privateOption!);

    expect(window.localStorage.getItem("sage.rail.job7")).toBe("starknet");
  });
});
