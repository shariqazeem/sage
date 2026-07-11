/**
 * DECISION COMMITMENT v2 — the cryptographic bond between an AI decision and a
 * CampaignVault V2 mission payout.
 *
 * V1 (payout-commitment.ts) is FROZEN and untouched. V2 adds the campaign/mission
 * dimension: the payout intent the vault consumes binds the CampaignVault, chain,
 * campaignIdHash, **missionIdHash**, recipient, the **exact on-chain mission
 * reward**, and the decision digest — so a payout cannot be re-pointed at a
 * different mission, recipient, amount, or a weaker decision than the one on record.
 *
 * `missionPlanDigest` here reproduces EXACTLY what CampaignVault.sol computes and
 * stores (see docs/CAMPAIGN_VAULT_V2.md §3), so the app, the vault, and the proof
 * all agree on the authorized mission plan.
 *
 * PURE — viem hashing only, no I/O. Canonical `encodeAbiParameters` + `keccak256`,
 * never `JSON.stringify`.
 */

import {
  type Hex,
  encodeAbiParameters,
  getAddress,
  keccak256,
  stringToHex,
} from "viem";

import type {
  BriefCriterion,
  BriefFraudSignal,
  BriefReasonCode,
  BriefRecommendation,
} from "./brain-core";

export const COMMITMENT_V2_VERSION = 2 as const;
export const COMMITMENT_V2_DOMAIN = "sage.decision.commitment.v2" as const;
export const PAYOUT_INTENT_V2_DOMAIN = "sage.payout.intent.v2" as const;
/** vault-kind tag committed into the digest (distinct from policy_v1). */
export const VAULT_KIND_CAMPAIGN_V2 = "campaign_v2" as const;

const ZERO32: Hex = `0x${"00".repeat(32)}`;

function hashString(s: string): Hex {
  return keccak256(stringToHex(s));
}
function hashOrZero(s: string | null | undefined): Hex {
  return s ? hashString(s) : ZERO32;
}
function quoteHash(quote: string | undefined): Hex {
  return quote ? hashString(quote) : ZERO32;
}

export function toBasisPointsV2(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  const bps = Math.round(confidence * 10_000);
  return bps < 0 ? 0 : bps > 10_000 ? 10_000 : bps;
}

export function evidenceToBytes32V2(sha256: string | null | undefined): Hex {
  if (!sha256) return ZERO32;
  const hex = sha256.startsWith("0x") ? sha256.slice(2) : sha256;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return ZERO32;
  return `0x${hex.toLowerCase()}` as Hex;
}

/** A bytes32 hex, validated; else the zero word. */
function asBytes32(h: string | null | undefined): Hex {
  if (!h) return ZERO32;
  const hex = h.startsWith("0x") ? h.slice(2) : h;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return ZERO32;
  return `0x${hex.toLowerCase()}` as Hex;
}

/* ───────────────────────────────────────── mission plan digest (on-chain) ── */

export interface MissionSpec {
  /** the bytes32 mission id used on-chain (missionIdHash). */
  missionId: Hex;
  rewardBase: bigint;
  maxCompletions: bigint;
}

/**
 * Reproduce CampaignVault.sol's `missionPlanDigest`:
 *   keccak256(abi.encode(bytes32 campaignIdHash, bytes32[] missionIds,
 *                        uint256[] rewards, uint256[] maxCompletions))
 * in the exact creation order. The vault stores this immutably; the app and the
 * proof recompute it to prove which plan authorized a payout.
 */
export function missionPlanDigest(
  campaignIdHash: Hex,
  missions: MissionSpec[],
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32[]" },
        { type: "uint256[]" },
        { type: "uint256[]" },
      ],
      [
        campaignIdHash,
        missions.map((m) => m.missionId),
        missions.map((m) => m.rewardBase),
        missions.map((m) => m.maxCompletions),
      ],
    ),
  );
}

/* ────────────────────────────────────────── decision commitment (v2) ────── */

export interface DecisionCommitmentV2Input {
  chainId: number;
  vault: string; // CampaignVault address
  campaignIdHash: Hex;
  missionPlanDigest: Hex;
  missionIdHash: Hex; // the bytes32 mission id
  submissionId: string;
  decisionId: string;
  recipient: string;
  /** the EXACT on-chain mission reward (base units) — never operator-chosen. */
  rewardBase: bigint;
  evidenceSha256: string | null;
  criteria: BriefCriterion[];
  fraudSignals: BriefFraudSignal[];
  recommendation: BriefRecommendation;
  reasonCode: BriefReasonCode;
  confidence: number;
  model: string | null;
  provider: string | null;
}

export interface DecisionCommitmentV2 {
  decisionDigest: Hex;
  payoutIntentHash: Hex;
}

const COMMITMENT_V2_ABI = [
  {
    type: "tuple",
    name: "commitment",
    components: [
      { name: "domain", type: "bytes32" },
      { name: "version", type: "uint16" },
      { name: "vaultKind", type: "bytes32" },
      { name: "chainId", type: "uint256" },
      { name: "vault", type: "address" },
      { name: "campaignIdHash", type: "bytes32" },
      { name: "missionPlanDigest", type: "bytes32" },
      { name: "missionIdHash", type: "bytes32" },
      { name: "submissionIdHash", type: "bytes32" },
      { name: "decisionIdHash", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "rewardBase", type: "uint256" },
      { name: "evidenceSha256", type: "bytes32" },
      { name: "recommendationHash", type: "bytes32" },
      { name: "reasonCodeHash", type: "bytes32" },
      { name: "confidenceBps", type: "uint16" },
      { name: "modelHash", type: "bytes32" },
      { name: "providerHash", type: "bytes32" },
      {
        name: "criteria",
        type: "tuple[]",
        components: [
          { name: "criterionHash", type: "bytes32" },
          { name: "met", type: "bool" },
          { name: "confidenceBps", type: "uint16" },
          { name: "quoteHash", type: "bytes32" },
        ],
      },
      { name: "acceptedQuoteHashes", type: "bytes32[]" },
      { name: "fraudSignalHashes", type: "bytes32[]" },
    ],
  },
] as const;

/** PayoutIntentV2 binds the on-chain-relevant fields + the decision digest. */
const PAYOUT_INTENT_V2_ABI = [
  {
    type: "tuple",
    name: "intent",
    components: [
      { name: "domain", type: "bytes32" },
      { name: "chainId", type: "uint256" },
      { name: "vault", type: "address" },
      { name: "campaignIdHash", type: "bytes32" },
      { name: "missionIdHash", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "rewardBase", type: "uint256" },
      { name: "decisionDigest", type: "bytes32" },
    ],
  },
] as const;

/**
 * Compute the v2 decision digest and the derived on-chain payout intent hash.
 * Throws on a malformed vault/recipient address (a payout is never committed to
 * garbage). `missionIdHash`, `campaignIdHash`, `missionPlanDigest` must be bytes32.
 */
export function computeDecisionCommitmentV2(
  input: DecisionCommitmentV2Input,
): DecisionCommitmentV2 {
  const vault = getAddress(input.vault);
  const recipient = getAddress(input.recipient);
  const campaignIdHash = asBytes32(input.campaignIdHash);
  const missionPlan = asBytes32(input.missionPlanDigest);
  const missionIdHash = asBytes32(input.missionIdHash);

  const criteria = input.criteria.map((c) => ({
    criterionHash: hashString(c.criterion),
    met: c.met,
    confidenceBps: toBasisPointsV2(c.confidence),
    quoteHash: quoteHash(c.quote),
  }));
  const acceptedQuoteHashes = input.criteria
    .filter((c): c is BriefCriterion & { quote: string } => !!c.quote)
    .map((c) => hashString(c.quote));
  const fraudSignalHashes = input.fraudSignals.map((s) =>
    hashString(`${s.signal} ${s.severity} ${s.reason}`),
  );

  const decisionDigest = keccak256(
    encodeAbiParameters(COMMITMENT_V2_ABI, [
      {
        domain: hashString(COMMITMENT_V2_DOMAIN),
        version: COMMITMENT_V2_VERSION,
        vaultKind: hashString(VAULT_KIND_CAMPAIGN_V2),
        chainId: BigInt(input.chainId),
        vault,
        campaignIdHash,
        missionPlanDigest: missionPlan,
        missionIdHash,
        submissionIdHash: hashString(input.submissionId),
        decisionIdHash: hashString(input.decisionId),
        recipient,
        rewardBase: input.rewardBase,
        evidenceSha256: evidenceToBytes32V2(input.evidenceSha256),
        recommendationHash: hashString(input.recommendation),
        reasonCodeHash: hashString(input.reasonCode),
        confidenceBps: toBasisPointsV2(input.confidence),
        modelHash: hashOrZero(input.model),
        providerHash: hashOrZero(input.provider),
        criteria,
        acceptedQuoteHashes,
        fraudSignalHashes,
      },
    ]),
  );

  const payoutIntentHash = payoutIntentV2({
    chainId: input.chainId,
    vault,
    campaignIdHash,
    missionIdHash,
    recipient,
    rewardBase: input.rewardBase,
    decisionDigest,
  });

  return { decisionDigest, payoutIntentHash };
}

/** Derive the v2 payout intent hash from its bound fields + the decision digest. */
export function payoutIntentV2(input: {
  chainId: number;
  vault: string;
  campaignIdHash: Hex;
  missionIdHash: Hex;
  recipient: string;
  rewardBase: bigint;
  decisionDigest: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(PAYOUT_INTENT_V2_ABI, [
      {
        domain: hashString(PAYOUT_INTENT_V2_DOMAIN),
        chainId: BigInt(input.chainId),
        vault: getAddress(input.vault),
        campaignIdHash: asBytes32(input.campaignIdHash),
        missionIdHash: asBytes32(input.missionIdHash),
        recipient: getAddress(input.recipient),
        rewardBase: input.rewardBase,
        decisionDigest: asBytes32(input.decisionDigest),
      },
    ]),
  );
}
