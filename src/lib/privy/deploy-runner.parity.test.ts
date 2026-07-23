import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PARITY (Telegram ↔ web) — the walletless deploy MUST bind the approved revision's VerificationPolicyV2 to the
 * new campaign, fail-closed, exactly like the web attach route (attach/route.ts:159). Before this, a covenant-
 * required (canary/action-replay) plan launched from chat left the campaign row with verificationPolicyRequired
 * =false and settlement silently paid under legacy rules. These tests pin the wiring: the deploy calls
 * attachApprovedPolicyToCampaign after attachV2Campaign, and a non-ok covenant attach ABORTS the deploy.
 */

const A = (c: string) => `0x${c.repeat(40)}` as const;

const { attachPolicySpy } = vi.hoisted(() => ({ attachPolicySpy: vi.fn() }));

vi.mock("@/lib/db/agent-wallets", () => ({ getAgentWallet: () => ({ privyWalletId: "pw", privyWalletAddress: A("1"), founderAddress: A("2"), chainId: 2345 }) }));
vi.mock("@/lib/launch/deployment-service", () => ({
  loadApprovedPlan: () => ({ plan: { publicCampaignId: "pub1", missions: [{ missionKey: "m", title: "t", objective: "o", instructions: "i", targetSurface: "https://x.test/", criteria: ["c"], evidenceRequirements: ["e"], rewardBase: "1000000", maxCompletions: "1" }] } }),
  buildSettings: () => ({ ok: true, settings: { chainId: 2345, token: A("3"), operator: A("4"), guardian: A("2"), factory: A("5") } }),
  defaultDailyCap: () => BigInt(1),
  DEFAULT_DURATION_SECONDS: 604800,
}));
vi.mock("@/lib/launch/deploy-plan", () => ({ buildDeployBundle: () => ({ predictedVault: A("6"), calls: [{ to: A("5"), data: "0x", step: "create" }] }), deriveDeploymentInputs: () => ({}) }));
vi.mock("./executor", () => ({ executeSequenceViaPrivy: async () => [{ txHash: "0xtx", explorerUrl: "http://e" }] }));
vi.mock("@/lib/db/inspection", () => ({ getInspectionJob: () => ({ productUrl: "https://x.test/" }) }));
vi.mock("@/lib/campaigns/v2-setup", () => ({ attachV2Campaign: async () => ({ ok: true, campaignId: "camp-1" }) }));
vi.mock("@/lib/campaigns/attach-policy", () => ({ attachApprovedPolicyToCampaign: attachPolicySpy }));

const { deployCampaignViaPrivy } = await import("./deploy-runner");

describe("deployCampaignViaPrivy — VerificationPolicyV2 covenant parity", () => {
  beforeEach(() => attachPolicySpy.mockReset());

  it("binds the approved revision's covenant to the deployed campaign (same call the web attach route makes)", async () => {
    attachPolicySpy.mockReturnValue({ ok: true, attached: true });
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.campaignId).toBe("camp-1");
    expect(attachPolicySpy).toHaveBeenCalledExactlyOnceWith("camp-1", "job-1"); // covenant bound to the new campaign
  });

  it("a non-ok covenant attach ABORTS the deploy — never a live campaign without its policy", async () => {
    attachPolicySpy.mockReturnValue({ ok: false, reason: "required_but_missing" });
    await expect(deployCampaignViaPrivy("chat-1", "job-1")).rejects.toThrow(/covenant could not attach.*required_but_missing/);
  });

  it("a legacy (non-required) revision attaches nothing and still deploys", async () => {
    attachPolicySpy.mockReturnValue({ ok: true, attached: false, reason: "no_policy" });
    const res = await deployCampaignViaPrivy("chat-1", "job-1");
    expect(res.campaignId).toBe("camp-1");
    expect(attachPolicySpy).toHaveBeenCalledOnce();
  });
});
