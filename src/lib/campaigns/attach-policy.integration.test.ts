import { describe, it, expect } from "vitest";

/**
 * Phase 8 — REAL-DB integration for the policy attach→load spine (the #1 defect: attach was never wired). Uses
 * the REAL compiler (never injects a policy into a fake campaign), the REAL plan-revision + campaign tables, and
 * the REAL attach service. Gated behind MONEY_BOUNDARY_E2E=1 with a temp SAGE_DB_PATH (npm run e2e:money-boundary).
 */

const RUN = process.env.MONEY_BOUNDARY_E2E === "1";

describe.runIf(RUN)("money-boundary E2E — approved revision → attach → real campaign row → loadVerifiedCampaignPolicy", () => {
  it("attaches a complete action policy write-once and loads it from the REAL campaign row; negatives fail closed", async () => {
    const { compileVerificationPolicyV2 } = await import("@/lib/launch/mission-probe-v2");
    const { createRevision, approveRevision } = await import("@/lib/db/plan-revisions");
    const { createCampaign, getCampaign, attachVerificationPolicyToCampaign, updateCampaignV2Plan } = await import("@/lib/db/campaigns");
    const { attachApprovedPolicyToCampaign } = await import("./attach-policy");
    const { loadVerifiedCampaignPolicy } = await import("@/lib/deputy/verification-policy");
    const { createInspectionJob } = await import("@/lib/db/inspection");
    const { V2_SET, V2_MISSION } = await import("@/lib/deputy/policy-test-fixtures");
    const { getAddress } = await import("viem");

    const PLAN = "0xplanE2E000000000000000000000000000000000000000000000000000000000";
    const WALLET = "0x00000000000000000000000000000000000000e8";
    // REAL compiler → a complete V2 action policy (one action criterion, one probe).
    const policy = compileVerificationPolicyV2({ missionPlanDigest: PLAN, productMapDigest: "0xmap", set: V2_SET, missions: [V2_MISSION], replayReproduced: new Set(["t-load"]), scope: { hosts: new Set(["app.test"]) } as never }).policy;
    expect(policy.actionCriteria).toHaveLength(1);
    expect(policy.probes).toHaveLength(1);

    // a real inspection job + a real plan revision carrying the policy (missionPlanDigest MUST match the plan).
    const { job } = createInspectionJob({ founderWallet: WALLET, publicCampaignId: "e2e-camp", productUrl: "https://app.test/", repoUrl: null, goal: "g", targetUsers: "u", totalBudgetBase: BigInt(1_000_000), tokenDecimals: 6 });
    const plan: Record<string, unknown> = { publicCampaignId: "e2e-camp", status: "draft", revision: 1, productMapDigest: "0xmap", missions: [], totalBudgetBase: BigInt(1_000_000), allocatedBase: BigInt(1_000_000), tokenDecimals: 6, campaignIdHash: "0xcamp", missionPlanDigest: PLAN, openQuestions: [], modelVersion: "m", promptVersion: "p" };
    const rev = createRevision({ jobId: job.id, authorWallet: WALLET, reason: "generated_grounded_v2", plan: plan as never, budgetBase: BigInt(1_000_000), validationOk: true, verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest, verificationPolicyRequired: true });
    // cross-plan binding is refused at createRevision:
    expect(() => createRevision({ jobId: job.id, authorWallet: WALLET, reason: "x", plan: { ...plan, missionPlanDigest: "0xother" } as never, budgetBase: BigInt(1), validationOk: true, verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest })).toThrow();
    approveRevision(job.id, rev.revisionNumber, WALLET, { ok: true });

    // a REAL campaign row bound to the same plan.
    const campaign = createCampaign({ title: "E2E", descriptionMd: "", criteria: [], conditionType: "approval", onchainCheck: null, rewardAmount: 500_000, maxRecipients: 1, vaultAddress: getAddress(`0x${"1".repeat(40)}`), posterWallet: WALLET, ownerIsSage: true, status: "live", autonomy: "autopilot", autopilotThreshold: 0.85 } as never);
    updateCampaignV2Plan(campaign.id, { vaultKind: "campaign_v2", campaignIdHash: "0xcamp", missionPlanDigest: PLAN, commitmentVersion: 2 });

    // ATTACH via the real service (reads the approved revision — NOT an injected policy).
    const a1 = attachApprovedPolicyToCampaign(campaign.id, job.id);
    expect(a1).toMatchObject({ ok: true, attached: true });
    // idempotent same-digest re-attach:
    expect(attachApprovedPolicyToCampaign(campaign.id, job.id)).toMatchObject({ ok: true });
    // a DIFFERENT digest is rejected (write-once):
    expect(attachVerificationPolicyToCampaign({ campaignId: campaign.id, policy: { ...policy, policyDigest: "0xNEW" }, policyDigest: "0xNEW", policyVersion: "verification-policy-v2", policyRequired: true, sourceRevisionNumber: 1, revisionMissionPlanDigest: PLAN })).toMatchObject({ ok: false, reason: "digest_conflict" });

    // LOAD from the REAL campaign row.
    const loaded = loadVerifiedCampaignPolicy(getCampaign(campaign.id)!);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) { expect(loaded.policy.policyDigest).toBe(policy.policyDigest); expect(loaded.policy.probes).toHaveLength(1); }

    // negative: a fresh campaign bound to a DIFFERENT plan cannot receive this policy.
    const other = createCampaign({ title: "Other", descriptionMd: "", criteria: [], conditionType: "approval", onchainCheck: null, rewardAmount: 1, maxRecipients: 1, vaultAddress: getAddress(`0x${"2".repeat(40)}`), posterWallet: WALLET, ownerIsSage: true, status: "live", autonomy: "autopilot", autopilotThreshold: 0.85 } as never);
    updateCampaignV2Plan(other.id, { vaultKind: "campaign_v2", campaignIdHash: "0xo", missionPlanDigest: "0xdifferent", commitmentVersion: 2 });
    expect(attachVerificationPolicyToCampaign({ campaignId: other.id, policy, policyDigest: policy.policyDigest, policyVersion: "verification-policy-v2", policyRequired: true, sourceRevisionNumber: 1, revisionMissionPlanDigest: PLAN })).toMatchObject({ ok: false, reason: "plan_mismatch" });
  });

  it("P2 activation fail-closed: required_but_missing → ok:false; non-required → attached:false; conflict → ok:false", async () => {
    const { compileVerificationPolicyV2 } = await import("@/lib/launch/mission-probe-v2");
    const { createRevision, approveRevision } = await import("@/lib/db/plan-revisions");
    const { createCampaign, getCampaign, updateCampaignV2Plan } = await import("@/lib/db/campaigns");
    const { attachApprovedPolicyToCampaign } = await import("./attach-policy");
    const { createInspectionJob } = await import("@/lib/db/inspection");
    const { V2_SET, V2_MISSION } = await import("@/lib/deputy/policy-test-fixtures");
    const { getAddress } = await import("viem");
    const WALLET = "0x00000000000000000000000000000000000000e9";
    const mkPlan = (digest: string) => ({ publicCampaignId: "p", status: "draft", revision: 1, productMapDigest: "0xmap", missions: [], totalBudgetBase: BigInt(1), allocatedBase: BigInt(1), tokenDecimals: 6, campaignIdHash: "0xc", missionPlanDigest: digest, openQuestions: [], modelVersion: "m", promptVersion: "p" });
    const mkCampaign = (digest: string, hexFill: string) => { const c = createCampaign({ title: hexFill, descriptionMd: "", criteria: [], conditionType: "approval", onchainCheck: null, rewardAmount: 1, maxRecipients: 1, vaultAddress: getAddress(`0x${hexFill.repeat(40)}`), posterWallet: WALLET, ownerIsSage: true, status: "live", autonomy: "autopilot", autopilotThreshold: 0.85 } as never); updateCampaignV2Plan(c.id, { vaultKind: "campaign_v2", campaignIdHash: "0xc", missionPlanDigest: digest, commitmentVersion: 2 }); return c; };

    // (a) REQUIRED revision with NO policy → activation must fail closed.
    const jNoPolicy = createInspectionJob({ founderWallet: WALLET, publicCampaignId: "p-nopolicy", productUrl: "https://app.test/", repoUrl: null, goal: "g", targetUsers: "u", totalBudgetBase: BigInt(1), tokenDecimals: 6 }).job;
    const rNo = createRevision({ jobId: jNoPolicy.id, authorWallet: WALLET, reason: "generated_grounded_v2", plan: mkPlan("0xreq") as never, budgetBase: BigInt(1), validationOk: true, verificationPolicyRequired: true });
    approveRevision(jNoPolicy.id, rNo.revisionNumber, WALLET, { ok: true });
    const cNo = mkCampaign("0xreq", "3");
    expect(attachApprovedPolicyToCampaign(cNo.id, jNoPolicy.id)).toMatchObject({ ok: false, reason: "required_but_missing" });
    expect(getCampaign(cNo.id)!.verificationPolicyDigest).toBeNull(); // nothing bound

    // (b) NON-required revision (no policy) → attached:false (activation proceeds).
    const jLegacy = createInspectionJob({ founderWallet: WALLET, publicCampaignId: "p-legacy", productUrl: "https://app.test/", repoUrl: null, goal: "g", targetUsers: "u", totalBudgetBase: BigInt(1), tokenDecimals: 6 }).job;
    const rLeg = createRevision({ jobId: jLegacy.id, authorWallet: WALLET, reason: "generated", plan: mkPlan("0xleg") as never, budgetBase: BigInt(1), validationOk: true, verificationPolicyRequired: false });
    approveRevision(jLegacy.id, rLeg.revisionNumber, WALLET, { ok: true });
    expect(attachApprovedPolicyToCampaign(mkCampaign("0xleg", "4").id, jLegacy.id)).toMatchObject({ ok: true, attached: false });

    // (c) required + complete policy → attach ok; re-attach idempotent.
    const jOk = createInspectionJob({ founderWallet: WALLET, publicCampaignId: "p-ok", productUrl: "https://app.test/", repoUrl: null, goal: "g", targetUsers: "u", totalBudgetBase: BigInt(1), tokenDecimals: 6 }).job;
    const pol = compileVerificationPolicyV2({ missionPlanDigest: "0xok", productMapDigest: "0xmap", set: V2_SET, missions: [V2_MISSION], replayReproduced: new Set(["t-load"]), scope: { hosts: new Set(["app.test"]) } as never }).policy;
    const rOk = createRevision({ jobId: jOk.id, authorWallet: WALLET, reason: "generated_grounded_v2", plan: mkPlan("0xok") as never, budgetBase: BigInt(1), validationOk: true, verificationPolicy: pol, verificationPolicyDigest: pol.policyDigest, verificationPolicyRequired: true });
    approveRevision(jOk.id, rOk.revisionNumber, WALLET, { ok: true });
    const cOk = mkCampaign("0xok", "5");
    expect(attachApprovedPolicyToCampaign(cOk.id, jOk.id)).toMatchObject({ ok: true, attached: true });
    expect(attachApprovedPolicyToCampaign(cOk.id, jOk.id)).toMatchObject({ ok: true }); // idempotent
    expect(getCampaign(cOk.id)!.verificationPolicyDigest).toBe(pol.policyDigest);
  });
});
