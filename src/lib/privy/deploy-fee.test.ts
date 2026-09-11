import { describe, it, expect, vi, beforeEach } from "vitest";

const A = (c: string) => `0x${c.repeat(40).slice(0, 40)}` as `0x${string}`;
type Call = { to: string; data: string; label: string };
const execSpy = vi.fn(async (..._a: unknown[]): Promise<Array<{ txHash: string; explorerUrl: string }>> => [
  { txHash: "0xtx", explorerUrl: "http://e" },
]);
const openOrderSpy = vi.fn(async (..._a: unknown[]) => ({ orderId: "ord-1", payToAddress: A("f") }));
const recordSpy = vi.fn();

vi.mock("@/lib/db/agent-wallets", () => ({
  getAgentWallet: () => ({ privyWalletId: "pw", privyWalletAddress: A("1"), founderAddress: A("2"), chainId: 2345 }),
}));
vi.mock("@/lib/launch/deployment-service", () => ({
  loadApprovedPlan: () => ({ plan: { publicCampaignId: "camp-1", totalBudgetBase: "10000000", missions: [] } }),
  buildSettings: () => ({ ok: true, settings: { chainId: 2345, token: A("7"), operator: A("8"), guardian: A("2"), factory: A("9") } }),
  defaultDailyCap: () => BigInt(1),
  DEFAULT_DURATION_SECONDS: BigInt(604800),
}));
vi.mock("@/lib/launch/deploy-plan", () => ({
  buildDeployBundle: (_p: unknown, s: { feeTo?: string }) => ({
    predictedVault: A("6"),
    calls: [{ to: A("5"), data: "0x", step: "create" }, ...(s.feeTo ? [{ to: A("7"), data: "0xfee", step: "fee" }] : [])],
  }),
  deriveDeploymentInputs: () => ({}),
}));
vi.mock("./executor", () => ({ executeSequenceViaPrivy: (...a: unknown[]) => execSpy(...(a as [])) }));
vi.mock("@/lib/db/inspection", () => ({ getInspectionJob: () => ({ productUrl: "https://x.test/" }) }));
const previewSpy = vi.fn(() => ({ ok: true, errors: [] as string[] }));
vi.mock("@/lib/campaigns/v2-setup", () => ({ attachV2Campaign: async () => ({ ok: true, campaignId: "camp-1" }), computeV2SetupPreview: () => previewSpy() }));
vi.mock("@/lib/campaigns/attach-policy", () => ({ attachApprovedPolicyToCampaign: () => ({ ok: true, attached: false }) }));
vi.mock("@/lib/x402/payer", () => ({ openCampaignFeeOrder: (...a: unknown[]) => openOrderSpy(...(a as [])) }));
vi.mock("@/lib/db/campaign-fees", () => ({ recordCampaignFee: (...a: unknown[]) => recordSpy(...(a as [])) }));

const { deployCampaignViaPrivy } = await import("./deploy-runner");

/**
 * THERE IS NO LAUNCH FEE. A 10% founder-side charge lived here behind an env switch and appeared in
 * no document, while every document described revenue as a flat fee per settlement. Deleted
 * 2026-09-05. These pin the absence: one sequence, no order, no row, and the founder's settings
 * cannot smuggle a fee step back in through `feeTo`.
 */
describe("deployCampaignViaPrivy — no launch fee, ever", () => {
  beforeEach(() => {
    execSpy.mockClear();
    openOrderSpy.mockClear();
    recordSpy.mockClear();
  });

  it("runs the core calls in ONE sequence and nothing else", async () => {
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.campaignId).toBe("camp-1");
    expect(execSpy).toHaveBeenCalledTimes(1);
    const seq = execSpy.mock.calls[0][2] as Call[];
    expect(seq.map((c) => c.label)).toEqual(["create"]);
  });

  it("opens no fee order and records no fee row", async () => {
    await deployCampaignViaPrivy("chat-1", "job-1");
    expect(openOrderSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("refuses a plan the campaign record would reject BEFORE any money moves", async () => {
    // Measured 2026-09-11 on Arc: a six-mission plan funded a vault and only then failed to be
    // recorded ("too_many_missions"). The record's own preview runs first now.
    previewSpy.mockReturnValueOnce({ ok: false, errors: ["too_many_missions"] });
    execSpy.mockClear();
    await expect(deployCampaignViaPrivy("web:x", "job-1")).rejects.toThrow(/cannot be recorded.*too_many_missions.*nothing was funded/);
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("reports only the core steps", async () => {
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.steps.map((s) => s.step)).toEqual(["create"]);
  });
});
