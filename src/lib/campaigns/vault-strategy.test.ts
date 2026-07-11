import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";

/**
 * The vault-strategy seam, against the REAL in-memory db + a fake V2 adapter (no
 * chain). Proves: strategy selection is exhaustive over the PERSISTED vault kind and
 * fails closed; the V2 strategy pays via requestPayout (four args, no amount) and
 * NEVER through vendor allowlisting; every DB↔chain agreement mismatch class HOLDS
 * before broadcast; and a recovered/decoded event that disagrees with the plan is an
 * integrity error, never a settlement.
 */

import {
  AmbiguousBroadcastError,
  CampaignVaultV2Strategy,
  PolicyVaultV1Strategy,
  SettlementIntegrityError,
  VaultAgreementError,
  selectVaultStrategy,
  settleWithRecoveryVia,
} from "./vault-strategy";
import { computeDecisionCommitmentV2 } from "@/lib/deputy/campaign-commitment";
import { getAttempt } from "@/lib/db/settlement-attempts";
import { createCampaign, createSubmission, getDecisionBySubmission } from "@/lib/db/campaigns";
import {
  V2_OPERATOR,
  agreeingSnapshot,
  makeFakeAdapter,
  outcomeMatching,
  seedV2Campaign,
  type V2Fixture,
} from "./campaign-v2.fixture";
import type { Campaign, Submission, VaultKind } from "@/lib/db/schema";

const OP = () => V2_OPERATOR;
const deps = (f: V2Fixture, over = {}) => ({
  campaignAdapter: makeFakeAdapter(f, over),
  operatorAddress: OP,
});

function v1Campaign(): { campaign: Campaign; submission: Submission } {
  const campaign = createCampaign({
    title: "v1",
    rewardAmount: 500_000,
    vaultAddress: `0x${"1".repeat(40)}`,
    posterWallet: `0x${"2".repeat(40)}`,
    chainId: 59902,
  });
  const r = createSubmission({ campaignId: campaign.id, wallet: `0x${"a".repeat(40)}` });
  if (!r.ok) throw new Error("seed v1 failed");
  return { campaign, submission: r.submission };
}

describe("selectVaultStrategy — exhaustive over persisted vaultKind", () => {
  it("policy_v1 → PolicyVaultV1Strategy", () => {
    const { campaign, submission } = v1Campaign();
    const s = selectVaultStrategy(campaign, submission, getDecisionBySubmission(submission.id));
    expect(s).toBeInstanceOf(PolicyVaultV1Strategy);
    expect(s.vaultKind).toBe("policy_v1");
    expect(s.commitmentVersion).toBe(1);
  });

  it("campaign_v2 → CampaignVaultV2Strategy", () => {
    const f = seedV2Campaign();
    const s = selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f));
    expect(s).toBeInstanceOf(CampaignVaultV2Strategy);
    expect(s.vaultKind).toBe("campaign_v2");
    expect(s.commitmentVersion).toBe(2);
  });

  it("an unknown vault kind FAILS CLOSED (throws), never a silent default", () => {
    const { campaign, submission } = v1Campaign();
    const bad = { ...campaign, vaultKind: "erc4337_weird" as VaultKind };
    expect(() => selectVaultStrategy(bad, submission, null)).toThrow(/unknown vault kind/);
  });

  it("campaign_v2 without a decision / mission / identity is refused", () => {
    const f = seedV2Campaign();
    expect(() => selectVaultStrategy(f.campaign, f.submission, null, deps(f))).toThrow(/requires a Deputy decision/);
    const noMission = { ...f.submission, missionIdHash: null };
    expect(() => selectVaultStrategy(f.campaign, noMission, f.decision, deps(f))).toThrow(/has no mission/);
    const noIdentity = { ...f.campaign, campaignIdHash: null };
    expect(() => selectVaultStrategy(noIdentity, f.submission, f.decision, deps(f))).toThrow(/on-chain identity/);
  });
});

describe("CampaignVaultV2Strategy — pays an unknown tester via requestPayout", () => {
  it("plan() reproduces the exact DecisionCommitmentV2 + mission reward", () => {
    const f = seedV2Campaign();
    const s = selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f));
    const plan = s.plan();
    const expected = computeDecisionCommitmentV2({
      chainId: f.campaign.chainId,
      vault: f.campaign.vaultAddress,
      campaignIdHash: f.campaign.campaignIdHash as Hex,
      missionPlanDigest: f.campaign.missionPlanDigest as Hex,
      missionIdHash: f.mission.missionIdHash as Hex,
      submissionId: f.submission.id,
      decisionId: f.decision.id,
      recipient: f.submission.wallet,
      rewardBase: BigInt(f.mission.rewardAmount),
      evidenceSha256: f.decision.contentSha256,
      criteria: f.decision.brief.criteria,
      fraudSignals: f.decision.brief.fraudSignals,
      recommendation: f.decision.brief.recommendation,
      reasonCode: f.decision.brief.reasonCode,
      confidence: f.decision.brief.confidence,
      model: f.decision.model,
      provider: f.decision.brief.provider,
    });
    expect(plan.payoutIntentHash).toBe(expected.payoutIntentHash);
    expect(plan.decisionDigest).toBe(expected.decisionDigest);
    expect(plan.amountBase).toBe(f.mission.rewardAmount); // the AGREED on-chain reward
    expect(plan.missionIdHash).toBe(f.mission.missionIdHash);
    expect(plan.vaultKind).toBe("campaign_v2");
  });

  it("settles an UNKNOWN recipient through requestPayout — no allowlisting, exact reward", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f, { calls }));

    const out = await settleWithRecoveryVia(strategy);

    expect(calls.requestPayout).toBe(1); // paid via requestPayout (no vendor add)
    expect(out.settled).toBe(true);
    expect(out.recipient).toBe(getAddress(f.submission.wallet));
    expect(out.amountBase).toBe(f.mission.rewardAmount);

    // durable attempt carries the V2 metadata.
    const attempt = getAttempt(strategy.plan().payoutIntentHash);
    expect(attempt?.status).toBe("settled");
    expect(attempt?.commitmentVersion).toBe(2);
    expect(attempt?.vaultKind).toBe("campaign_v2");
    expect(attempt?.missionIdHash).toBe(f.mission.missionIdHash);
  });

  it("a re-fire after settlement returns the record WITHOUT re-broadcasting", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f, { calls }));
    await settleWithRecoveryVia(strategy);
    const again = await settleWithRecoveryVia(
      selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f, { calls })),
    );
    expect(again.settled).toBe(true);
    expect(calls.requestPayout).toBe(1); // still ONE broadcast total
  });
});

describe("agreement enforcement — every mismatch class HOLDS before broadcast", () => {
  const brokenSnapshots = (f: V2Fixture): Record<string, ReturnType<typeof agreeingSnapshot>> => {
    const wrongReward = agreeingSnapshot(f);
    wrongReward.missions[f.mission.missionIdHash.toLowerCase()] = {
      exists: true,
      rewardBase: BigInt(f.mission.rewardAmount + 1),
      maxCompletions: BigInt(f.mission.maxCompletions),
    };
    const missingMission = agreeingSnapshot(f);
    delete missingMission.missions[f.mission.missionIdHash.toLowerCase()];
    return {
      provenance: agreeingSnapshot(f, { factoryRecognizes: false }),
      owner_not_founder: agreeingSnapshot(f, { owner: `0x${"9".repeat(40)}` }),
      operator_mismatch: agreeingSnapshot(f, { operator: `0x${"8".repeat(40)}` }),
      owner_equals_operator: agreeingSnapshot(f, { owner: V2_OPERATOR }),
      campaign_id_hash: agreeingSnapshot(f, { campaignIdHash: `0x${"c".repeat(64)}` }),
      mission_plan_digest: agreeingSnapshot(f, { missionPlanDigest: `0x${"d".repeat(64)}` }),
      budget: agreeingSnapshot(f, { budgetCeiling: BigInt(1) }),
      lifecycle: agreeingSnapshot(f, { state: "revoked" }),
      replay_support: agreeingSnapshot(f, { replaySupport: "legacy" }),
      mission_reward: wrongReward,
      mission_missing: missingMission,
    };
  };

  it("each broken snapshot throws VaultAgreementError and NEVER calls requestPayout", async () => {
    for (const [label, snapshot] of Object.entries(brokenSnapshots(seedV2Campaign()))) {
      const f = seedV2Campaign();
      const calls = { requestPayout: 0 };
      const strategy = selectVaultStrategy(
        f.campaign,
        f.submission,
        f.decision,
        deps(f, { snapshot, calls }),
      );
      await expect(settleWithRecoveryVia(strategy), label).rejects.toBeInstanceOf(VaultAgreementError);
      expect(calls.requestPayout, label).toBe(0);
      expect(getAttempt(strategy.plan().payoutIntentHash)?.status, label).not.toBe("settled");
    }
  });
});

describe("independent token agreement (Part 4)", () => {
  const MOCK_USDC = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");

  it("the expected token comes from the DB, not the vault — a wrong vault token HOLDS", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    // the vault reports a DIFFERENT token than the campaign's persisted settlementToken.
    const snapshot = agreeingSnapshot(f, { token: `0x${"4".repeat(40)}` });
    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f, { snapshot, calls }));
    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(VaultAgreementError);
    expect(calls.requestPayout).toBe(0);
  });

  it("a MISSING expected token fails closed (never trusts the vault's own token)", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    // clear the persisted token — there is no fallback to the vault, so it can't agree.
    const noToken = { ...f.campaign, settlementToken: null };
    const strategy = selectVaultStrategy(noToken, f.submission, f.decision, deps(f, { calls }));
    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(VaultAgreementError);
    expect(calls.requestPayout).toBe(0);
  });

  it("an explicitly-configured testnet token (Metis Sepolia MockUSDC) agrees", async () => {
    const f = seedV2Campaign({ token: MOCK_USDC, chainId: 59902 });
    const calls = { requestPayout: 0 };
    const snapshot = agreeingSnapshot(f, { token: MOCK_USDC });
    const out = await settleWithRecoveryVia(
      selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f, { snapshot, calls })),
    );
    expect(out.settled).toBe(true);
    expect(calls.requestPayout).toBe(1);
  });
});

describe("phase-2 replay pre-flight (Part 5) — a used intent is never broadcast", () => {
  it("an already-used intent with a matching settlement reconciles WITHOUT broadcasting", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const plan = selectVaultStrategy(f.campaign, f.submission, f.decision, deps(f)).plan();
    const strategy = selectVaultStrategy(
      f.campaign,
      f.submission,
      f.decision,
      deps(f, { calls, intentUsed: true, allOutcomes: [outcomeMatching(plan, "0xPRIOR" as `0x${string}`)] }),
    );
    const out = await settleWithRecoveryVia(strategy);
    expect(out.settled).toBe(true);
    expect(calls.requestPayout).toBe(0); // reconciled, never re-broadcast
  });

  it("an already-used intent with no trustworthy outcome HOLDS, never broadcasts", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const strategy = selectVaultStrategy(
      f.campaign,
      f.submission,
      f.decision,
      deps(f, { calls, intentUsed: true, allOutcomes: [] }),
    );
    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(AmbiguousBroadcastError);
    expect(calls.requestPayout).toBe(0);
  });
});

describe("integrity — a decoded event that disagrees with the plan cannot settle", () => {
  it("a wrong emitted reward is a SettlementIntegrityError, never a paid submission", async () => {
    const f = seedV2Campaign();
    const strategy = selectVaultStrategy(
      f.campaign,
      f.submission,
      f.decision,
      deps(f, { settledAmountBase: f.mission.rewardAmount + 12_345 }),
    );
    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(SettlementIntegrityError);
    expect(getAttempt(strategy.plan().payoutIntentHash)?.status).not.toBe("settled");
  });

  it("a wrong recipient in the decoded event is an integrity error", async () => {
    const f = seedV2Campaign();
    const strategy = selectVaultStrategy(
      f.campaign,
      f.submission,
      f.decision,
      deps(f, { outcomeOverride: { recipient: getAddress(`0x${"7".repeat(40)}`) } }),
    );
    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(SettlementIntegrityError);
    expect(getAttempt(strategy.plan().payoutIntentHash)?.status).not.toBe("settled");
  });
});
