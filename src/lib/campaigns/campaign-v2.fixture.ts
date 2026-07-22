import { getAddress, keccak256, stringToHex, type Address, type Hash } from "viem";

import {
  createCampaign,
  createMission,
  createSubmission,
  getCampaign,
  getDecisionBySubmission,
  insertDecision,
  updateCampaignV2Plan,
} from "@/lib/db/campaigns";
import { chainConfig } from "@/lib/deputy/networks";
import { computeCampaignPlan, missionIdHash, type MissionInput } from "./mission-plan";
import type { ChainCampaignSnapshot } from "./vault-agreement";
import type {
  CampaignPayoutOutcome,
  CampaignVaultAdapter,
} from "@/lib/deputy/campaign-vault";
import type { Campaign, Decision, Mission, Submission } from "@/lib/db/schema";
import type { StoredBrief } from "@/lib/deputy/brain-core";

/**
 * Test fixtures for CampaignVault V2 — seed a REAL campaign_v2 campaign (with its
 * on-chain identity computed from mission-plan.ts), matching missions, a tester
 * submission, and a Deputy decision; plus an AGREEING chain snapshot and a fake
 * adapter that echoes requestPayout into a settlement. Shared by the strategy,
 * pipeline, and recovery suites so they all exercise the same real wiring.
 */

export const V2_OPERATOR: Address = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
export const V2_TOKEN: Address = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
export const FIXTURE_TX = `0x${"f".repeat(64)}` as Hash;

let seq = 0;

export function payBrief(): StoredBrief {
  return {
    criteria: [{ criterion: "the app loads", met: true, confidence: 0.97, quote: "it loads fine" }],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.97,
    summary: "genuine tester work",
    provider: "api.commonstack.ai",
    // the APPROVED policy identity (paired with the approved model set in seedV2Campaign) — so the
    // reconstructed brief clears the autopay identity gate on the happy path.
    promptVersion: "payout-v1",
    parserVersion: "payout-parse-v1",
  };
}

export interface V2Fixture {
  campaign: Campaign;
  missions: Mission[];
  mission: Mission;
  submission: Submission;
  decision: Decision;
}

const DEFAULT_MISSIONS: MissionInput[] = [
  { missionKey: "load", rewardBase: BigInt(500_000), maxCompletions: BigInt(4) },
  { missionKey: "signup", rewardBase: BigInt(1_000_000), maxCompletions: BigInt(2) },
];

/** Seed a live campaign_v2 campaign + missions + one tester submission + decision. */
export function seedV2Campaign(opts?: {
  wallet?: string;
  missions?: MissionInput[];
  vaultAddress?: string;
  chainId?: number;
  founder?: string;
  /** the independent expected settlement token (Part 4); defaults to V2_TOKEN. */
  token?: string;
}): V2Fixture {
  const missionsInput = opts?.missions ?? DEFAULT_MISSIONS;
  const vaultAddress = opts?.vaultAddress ?? `0x${"1".repeat(40)}`;
  const chainId = opts?.chainId ?? 59902;
  const founder = opts?.founder ?? `0x${"b".repeat(40)}`; // founder ≠ operator

  // Create first to get the public id, then compute the on-chain plan from it.
  const created = createCampaign({
    title: "V2 mission campaign",
    rewardAmount: Number(missionsInput[0].rewardBase),
    vaultAddress,
    posterWallet: founder,
    chainId,
    ownerIsSage: false,
    status: "live",
    autonomy: "autopilot",
    autopilotThreshold: 0.85,
    // recorded INDEPENDENTLY of the vault (Part 4) — the expected settlement token.
    settlementToken: opts?.token ?? V2_TOKEN,
  });
  const plan = computeCampaignPlan(created.id, missionsInput);
  updateCampaignV2Plan(created.id, {
    vaultKind: "campaign_v2",
    campaignIdHash: plan.campaignIdHash,
    missionPlanDigest: plan.missionPlanDigest,
    commitmentVersion: 2,
  });

  const missions = missionsInput.map((m, i) =>
    createMission({
      campaignId: created.id,
      missionKey: m.missionKey,
      missionIdHash: missionIdHash(created.id, m.missionKey),
      title: m.missionKey,
      rewardAmount: Number(m.rewardBase),
      maxCompletions: Number(m.maxCompletions),
      displayOrder: i,
      // The settle-path fixtures exercise AUTOPAY, which post-P16 only applies to url-verifiable
      // missions; observation-based holds are covered in pipeline.test.ts.
      verifiabilityClass: "url-verifiable",
    }),
  );

  seq += 1;
  const wallet = opts?.wallet ?? `0x${seq.toString(16).padStart(40, "e")}`;
  const r = createSubmission({
    campaignId: created.id,
    wallet,
    missionIdHash: missions[0].missionIdHash,
  });
  if (!r.ok) throw new Error(`seedV2Campaign submission failed: ${r.error}`);

  insertDecision({
    submissionId: r.submission.id,
    campaignId: created.id,
    engine: "llm",
    model: "google/gemini-3.1-flash-lite-preview",
    brief: payBrief(),
    contentSha256: "a".repeat(64),
    evidenceOk: true,
    latencyMs: 1200,
    costUsd: 0.0003,
    x402PaymentTx: null,
    commitmentVersion: 2,
    missionIdHash: missions[0].missionIdHash,
    vaultKind: "campaign_v2",
  });

  return {
    campaign: getCampaign(created.id) as Campaign,
    missions,
    mission: missions[0],
    submission: r.submission,
    decision: getDecisionBySubmission(r.submission.id) as Decision,
  };
}

/** A chain snapshot that AGREES with the seeded campaign + missions (override to break it). */
export function agreeingSnapshot(
  f: V2Fixture,
  over: Partial<ChainCampaignSnapshot> = {},
): ChainCampaignSnapshot {
  const missions: ChainCampaignSnapshot["missions"] = {};
  for (const m of f.missions) {
    missions[m.missionIdHash.toLowerCase()] = {
      exists: true,
      rewardBase: BigInt(m.rewardAmount),
      maxCompletions: BigInt(m.maxCompletions),
    };
  }
  const budget = f.missions.reduce(
    (s, m) => s + BigInt(m.rewardAmount) * BigInt(m.maxCompletions),
    BigInt(0),
  );
  return {
    factoryRecognizes: true,
    owner: f.campaign.posterWallet,
    operator: V2_OPERATOR,
    guardian: "0x0000000000000000000000000000000000000000",
    token: V2_TOKEN,
    campaignIdHash: f.campaign.campaignIdHash as string,
    missionPlanDigest: f.campaign.missionPlanDigest as string,
    budgetCeiling: budget,
    chainId: f.campaign.chainId,
    state: "active",
    replaySupport: "supported",
    missions,
    ...over,
  };
}

/** A decoded outcome that MATCHES a plan — the happy recovery/resume case. */
export function outcomeMatching(
  plan: {
    vaultAddress: string;
    chainId: number;
    missionIdHash: Hash | null;
    recipient: string;
    payoutIntentHash: Hash;
    decisionDigest: Hash | null;
    amountBase: number;
  },
  txHash: Hash,
  over: Partial<CampaignPayoutOutcome> = {},
): CampaignPayoutOutcome {
  return {
    status: "settled",
    txHash,
    blockNumber: 200,
    vault: getAddress(plan.vaultAddress),
    chainId: chainConfig(plan.chainId).chainId,
    missionId: (plan.missionIdHash ?? `0x${"0".repeat(64)}`) as Hash,
    recipient: getAddress(plan.recipient),
    intentHash: plan.payoutIntentHash,
    decisionDigest: (plan.decisionDigest ?? `0x${"0".repeat(64)}`) as Hash,
    amountBase: plan.amountBase,
    failedCheckIndex: null,
    explorerUrl: `https://x/tx/${txHash}`,
    ...over,
  };
}

/** Options that let a test bend the fake adapter's behavior. */
export interface FakeAdapterOptions {
  snapshot?: ChainCampaignSnapshot;
  /** override the settled amount the vault "derives" (to force a reward mismatch). */
  settledAmountBase?: number;
  /** if set, requestPayout/await return a rejection with this check index. */
  rejectCheck?: number;
  /** override fields on the decoded outcome (to force an integrity mismatch). */
  outcomeOverride?: Partial<CampaignPayoutOutcome>;
  /** the exact outcome awaitOutcome returns (crash-recovery resume). */
  resumeOutcome?: CampaignPayoutOutcome;
  /** isIntentUsed answer (recovery + phase-2 replay). */
  intentUsed?: boolean;
  /** ALL on-chain outcomes findAllOutcomesByIntent returns (canonical resolution). */
  allOutcomes?: CampaignPayoutOutcome[];
  /** getSenderNonce answers — used-nonce ⟺ a tx was accepted. */
  senderNonce?: { pending: number; latest: number };
  /** the nonce the pre-flight reserves (recorded into the durable attempt). */
  reservedNonce?: number;
  /** make requestPayout throw AFTER firing onPreflight (models a send that crashed). */
  throwOnSend?: boolean;
  readiness?: {
    state: "created" | "funded" | "active" | "paused" | "revoked";
    budgetRemainingBase: number;
    missionRemaining: number;
    recipientCompleted: boolean;
    velocityCapBase?: number;
    rollingSpendBase?: number;
  };
  /** spies the test can inspect. */
  calls?: { requestPayout: number; senders?: string[] };
}

/** A fake CampaignVault adapter that echoes requestPayout into a decoded settlement. */
export function makeFakeAdapter(f: V2Fixture, opts: FakeAdapterOptions = {}): CampaignVaultAdapter {
  const chainId = chainConfig(f.campaign.chainId).chainId;
  const sender = V2_OPERATOR;
  // A per-campaign settle tx so the real (kind, txHash) journal dedup doesn't collapse
  // settlements ACROSS distinct test campaigns sharing one in-memory DB.
  const settleTx = keccak256(stringToHex(`fixture-tx:${f.campaign.id}`));
  const decode = (args: {
    vault: Address;
    missionId: Hash;
    recipient: Address;
    decisionDigest: Hash;
    intentHash: Hash;
  }): CampaignPayoutOutcome => {
    const rejected = opts.rejectCheck != null;
    const base: CampaignPayoutOutcome = {
      status: rejected ? "rejected" : "settled",
      txHash: settleTx,
      blockNumber: 100,
      vault: getAddress(args.vault),
      chainId,
      missionId: args.missionId,
      recipient: getAddress(args.recipient),
      intentHash: args.intentHash,
      decisionDigest: args.decisionDigest,
      amountBase: opts.settledAmountBase ?? f.mission.rewardAmount,
      failedCheckIndex: opts.rejectCheck ?? null,
      explorerUrl: `https://x/tx/${settleTx}`,
    };
    return { ...base, ...opts.outcomeOverride };
  };
  return {
    async readSnapshot() {
      return opts.snapshot ?? agreeingSnapshot(f);
    },
    async requestPayout(args) {
      if (opts.calls) {
        opts.calls.requestPayout += 1;
        opts.calls.senders?.push(sender);
      }
      // Fire the pre-flight identity hook BEFORE "submitting" — the crash-window fix.
      await args.onPreflight?.({ sender, nonce: opts.reservedNonce ?? 7, calldataHash: `0x${"1".repeat(64)}` });
      if (opts.throwOnSend) throw new Error("fake adapter: send crashed after onPreflight");
      await args.onBroadcast?.(settleTx);
      return decode(args);
    },
    async awaitOutcome(txHash) {
      // A test supplies the exact decoded outcome for a resumed tx; without it we
      // cannot know the plan's committed hashes here, so a resume outcome is required.
      if (!opts.resumeOutcome) {
        throw new Error("fake adapter: awaitOutcome needs opts.resumeOutcome for this test");
      }
      return { ...opts.resumeOutcome, txHash };
    },
    async readMissionReadiness() {
      const base = opts.readiness ?? {
        state: "active" as const,
        budgetRemainingBase: 1_000_000_000,
        missionRemaining: 4,
        recipientCompleted: false,
      };
      return {
        ...base,
        velocityCapBase: base.velocityCapBase ?? 1_000_000_000,
        rollingSpendBase: base.rollingSpendBase ?? 0,
      };
    },
    async isIntentUsed() {
      return opts.intentUsed ?? false;
    },
    async findAllOutcomesByIntent() {
      return opts.allOutcomes ?? [];
    },
    async getSenderNonce(_sender, _chainId, blockTag) {
      const n = opts.senderNonce ?? { pending: 7, latest: 7 };
      return blockTag === "pending" ? n.pending : n.latest;
    },
  };
}
