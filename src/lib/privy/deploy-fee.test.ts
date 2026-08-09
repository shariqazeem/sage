import { describe, it, expect, vi, beforeEach } from "vitest";

// the fee is env-gated off by default so a deploy never charges by accident; arm it for these tests
process.env.CAMPAIGN_FEE_ENABLED = "1";

const A = (c: string) => `0x${c.repeat(40).slice(0, 40)}` as `0x${string}`;
const FEE_TO = A("f");

type Call = { to: string; data: string; label: string };
const execSpy = vi.fn(async (..._a: unknown[]): Promise<Array<{ txHash: string; explorerUrl: string }>> => [
  { txHash: "0xtx", explorerUrl: "http://e" },
]);
const settledSpy = vi.fn();
const failureSpy = vi.fn();
const recordSpy = vi.fn();
const openOrderSpy = vi.fn(
  async (..._a: unknown[]): Promise<{ orderId: string; payToAddress: string } | null> => ({
    orderId: "ord-1",
    payToAddress: FEE_TO,
  }),
);

vi.mock("@/lib/db/agent-wallets", () => ({
  getAgentWallet: () => ({ privyWalletId: "pw", privyWalletAddress: A("1"), founderAddress: A("2"), chainId: 2345 }),
}));
vi.mock("@/lib/launch/deployment-service", () => ({
  loadApprovedPlan: () => ({
    plan: { publicCampaignId: "camp-1", totalBudgetBase: "10000000", missions: [] }, // $10 → $1 fee
  }),
  buildSettings: () => ({ ok: true, settings: { chainId: 2345, token: A("7"), operator: A("8"), guardian: A("2"), factory: A("9") } }),
  defaultDailyCap: () => BigInt(1),
  DEFAULT_DURATION_SECONDS: BigInt(604800),
}));
vi.mock("@/lib/launch/deploy-plan", () => ({
  buildDeployBundle: (_p: unknown, s: { feeTo?: string }) => ({
    predictedVault: A("6"),
    calls: [
      { to: A("5"), data: "0x", step: "create" },
      ...(s.feeTo ? [{ to: A("7"), data: "0xfee", step: "fee" }] : []),
    ],
  }),
  deriveDeploymentInputs: () => ({}),
}));
vi.mock("./executor", () => ({ executeSequenceViaPrivy: (...a: unknown[]) => execSpy(...(a as [])) }));
vi.mock("@/lib/db/inspection", () => ({ getInspectionJob: () => ({ productUrl: "https://x.test/" }) }));
vi.mock("@/lib/campaigns/v2-setup", () => ({ attachV2Campaign: async () => ({ ok: true, campaignId: "camp-1" }) }));
vi.mock("@/lib/campaigns/attach-policy", () => ({ attachApprovedPolicyToCampaign: () => ({ ok: true, attached: false }) }));
vi.mock("@/lib/x402/payer", () => ({ openCampaignFeeOrder: (...a: unknown[]) => openOrderSpy(...(a as [])) }));
vi.mock("@/lib/db/campaign-fees", () => ({
  recordCampaignFee: (...a: unknown[]) => recordSpy(...(a as [])),
  getCampaignFee: () => ({ id: "fee-row-1" }),
  markCampaignFeeSettled: (...a: unknown[]) => settledSpy(...(a as [])),
  recordCampaignFeeFailure: (...a: unknown[]) => failureSpy(...(a as [])),
}));

const { deployCampaignViaPrivy } = await import("./deploy-runner");

/**
 * A BILLING DETAIL MUST NEVER COST A FOUNDER THEIR LAUNCH.
 *
 * Every wallet onboarded before the fee existed carries a mandate with no fee rule, and Privy's
 * enclave refuses anything outside the policy. Run inside the main sequence, that refusal throws
 * AFTER create/approve/fund/activate have succeeded — the vault is live and funded, but
 * attachV2Campaign never runs, leaving a real on-chain campaign with no database row, invisible to
 * both the founder and the sweep. Far worse than an uncollected fee. These pin the isolation.
 */
describe("deployCampaignViaPrivy — the launch fee is never load-bearing", () => {
  beforeEach(() => {
    execSpy.mockClear();
    settledSpy.mockClear();
    failureSpy.mockClear();
    recordSpy.mockClear();
    openOrderSpy.mockClear();
    execSpy.mockImplementation(async () => [{ txHash: "0xtx", explorerUrl: "http://e" }]);
  });

  it("charges the fee in its OWN sequence, separate from the core calls", async () => {
    await deployCampaignViaPrivy("chat-1", "job-1");
    expect(execSpy).toHaveBeenCalledTimes(2); // core, then fee — never one combined sequence
    const feeSeq = execSpy.mock.calls[1][2] as Call[];
    expect(feeSeq).toHaveLength(1);
    expect(feeSeq[0].label).toBe("fee");
  });

  it("records the fee as settled with the real tx", async () => {
    await deployCampaignViaPrivy("chat-1", "job-1");
    expect(settledSpy).toHaveBeenCalledWith("fee-row-1", "0xtx", "ord-1");
  });

  it("charges 10% of the approved budget, from the plan and not the caller", async () => {
    await deployCampaignViaPrivy("chat-1", "job-1");
    expect(openOrderSpy.mock.calls[0][0]).toMatchObject({ amountBase: BigInt(1_000_000) }); // $10 → $1
    expect(recordSpy.mock.calls[0][0]).toMatchObject({ budgetBase: 10_000_000, amountBase: 1_000_000 });
  });

  it("STILL DEPLOYS when the fee is refused — the campaign is attached and the failure recorded", async () => {
    // exactly the old-mandate case: core succeeds, the fee signature is refused
    execSpy.mockImplementationOnce(async () => [{ txHash: "0xtx", explorerUrl: "http://e" }]);
    execSpy.mockImplementationOnce(async () => {
      throw new Error("policy denied: no rule permits this transfer");
    });
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.campaignId).toBe("camp-1"); // the launch survived
    expect(settledSpy).not.toHaveBeenCalled();
    expect(failureSpy.mock.calls[0][1]).toContain("policy denied");
  });

  it("deploys normally when the fee rail is offline, with no fee call at all", async () => {
    openOrderSpy.mockImplementationOnce(async () => null);
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.campaignId).toBe("camp-1");
    expect(execSpy).toHaveBeenCalledTimes(1); // core only
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("reports only the CORE steps, so a caller cannot mistake the fee for a deploy step", async () => {
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.steps.map((s) => s.step)).toEqual(["create"]);
  });
});
