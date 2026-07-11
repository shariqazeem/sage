import { describe, expect, it } from "vitest";
import { keccak256, stringToHex, type Hex } from "viem";

import {
  computeDecisionCommitmentV2,
  missionPlanDigest,
  payoutIntentV2,
  type DecisionCommitmentV2Input,
  type MissionSpec,
} from "./campaign-commitment";

// The SAME plan CampaignVault.t.sol deploys, so the golden below is cross-checked
// on-chain by test/CampaignVault.t.sol::test_MissionPlanDigest_MatchesOffchain.
const CAMPAIGN = keccak256(stringToHex("campaign-1"));
const M1 = keccak256(stringToHex("mission-1"));
const M2 = keccak256(stringToHex("mission-2"));
const PLAN: MissionSpec[] = [
  { missionId: M1, rewardBase: BigInt(10_000_000), maxCompletions: BigInt(2) },
  { missionId: M2, rewardBase: BigInt(5_000_000), maxCompletions: BigInt(3) },
];

const SHA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function base(): DecisionCommitmentV2Input {
  return {
    chainId: 59902,
    vault: "0xa37DE5781c297CbB0F5e10AD89C638517506416d",
    campaignIdHash: CAMPAIGN,
    missionPlanDigest: missionPlanDigest(CAMPAIGN, PLAN),
    missionIdHash: M1,
    submissionId: "sub_v2",
    decisionId: "dec_v2",
    recipient: "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3",
    rewardBase: BigInt(10_000_000),
    evidenceSha256: SHA,
    criteria: [
      { criterion: "The app loads", met: true, confidence: 0.95, quote: "it loads" },
    ],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.95,
    model: "gemini-3.1-flash-lite-preview",
    provider: "api.commonstack.ai",
  };
}
const digestOf = (i: DecisionCommitmentV2Input) => computeDecisionCommitmentV2(i).decisionDigest;

describe("missionPlanDigest — reproduces the on-chain encoding", () => {
  it("is deterministic and order-sensitive", () => {
    expect(missionPlanDigest(CAMPAIGN, PLAN)).toEqual(missionPlanDigest(CAMPAIGN, PLAN));
    const swapped = [PLAN[1], PLAN[0]];
    expect(missionPlanDigest(CAMPAIGN, swapped)).not.toEqual(missionPlanDigest(CAMPAIGN, PLAN));
  });
  it("changes when a reward or cap changes", () => {
    const d0 = missionPlanDigest(CAMPAIGN, PLAN);
    expect(
      missionPlanDigest(CAMPAIGN, [{ ...PLAN[0], rewardBase: BigInt(10_000_001) }, PLAN[1]]),
    ).not.toEqual(d0);
    expect(
      missionPlanDigest(CAMPAIGN, [{ ...PLAN[0], maxCompletions: BigInt(3) }, PLAN[1]]),
    ).not.toEqual(d0);
  });
  it("GOLDEN — the exact digest CampaignVault.t.sol asserts on-chain", () => {
    // If this changes, update test/CampaignVault.t.sol's on-chain cross-check too.
    expect(missionPlanDigest(CAMPAIGN, PLAN)).toMatchInlineSnapshot(`"0x3ee1ee06b5edadc8dbb2d84c2508503b8499c35c52b102b8ab3d41813e41e87a"`);
  });
});

describe("computeDecisionCommitmentV2 — shape, determinism, golden", () => {
  it("returns two distinct 32-byte hashes; intent ≠ digest", () => {
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitmentV2(base());
    expect(decisionDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payoutIntentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payoutIntentHash).not.toEqual(decisionDigest);
  });
  it("is deterministic", () => {
    const a = computeDecisionCommitmentV2(base());
    const b = computeDecisionCommitmentV2(base());
    expect(a).toEqual(b);
  });
  it("pins the canonical v2 encoding (golden)", () => {
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitmentV2(base());
    expect(decisionDigest).toMatchInlineSnapshot(`"0xd59328ed6f827166e9c24ba2a2a4875825a8d80ecb7710ef1a0402b71c61e7d1"`);
    expect(payoutIntentHash).toMatchInlineSnapshot(`"0xe67ea315823deee0a192fdf9ea642d92df539d7639360bad513a8119915f77a6"`);
  });
});

describe("computeDecisionCommitmentV2 — every V2 field is load-bearing", () => {
  const b = base();
  const d0 = digestOf(b);
  it("mission / campaign / plan changes flip the digest", () => {
    expect(digestOf({ ...b, missionIdHash: M2 })).not.toEqual(d0);
    expect(digestOf({ ...b, campaignIdHash: keccak256(stringToHex("other")) })).not.toEqual(d0);
    expect(digestOf({ ...b, missionPlanDigest: keccak256(stringToHex("x")) as Hex })).not.toEqual(d0);
  });
  it("reward / recipient / vault / chain changes flip the digest", () => {
    expect(digestOf({ ...b, rewardBase: BigInt(10_000_001) })).not.toEqual(d0);
    expect(digestOf({ ...b, recipient: "0x0000000000000000000000000000000000000001" })).not.toEqual(d0);
    expect(digestOf({ ...b, vault: "0x991047490eE07178dcf270221e4BFa47793C8915" })).not.toEqual(d0);
    expect(digestOf({ ...b, chainId: 2345 })).not.toEqual(d0);
  });
});

describe("payoutIntentV2 — binds mission + reward + recipient + digest", () => {
  it("changing the mission or reward changes the intent", () => {
    const args = {
      chainId: 59902,
      vault: "0xa37DE5781c297CbB0F5e10AD89C638517506416d",
      campaignIdHash: CAMPAIGN,
      missionIdHash: M1,
      recipient: "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3",
      rewardBase: BigInt(10_000_000),
      decisionDigest: keccak256(stringToHex("dd")) as Hex,
    };
    const i0 = payoutIntentV2(args);
    expect(payoutIntentV2({ ...args, missionIdHash: M2 })).not.toEqual(i0);
    expect(payoutIntentV2({ ...args, rewardBase: BigInt(10_000_001) })).not.toEqual(i0);
    expect(payoutIntentV2({ ...args, recipient: "0x0000000000000000000000000000000000000002" })).not.toEqual(i0);
  });
});
