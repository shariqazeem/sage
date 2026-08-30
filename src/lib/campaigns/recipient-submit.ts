import "server-only";

import { getAddress } from "viem";

import { MAX_ACCOUNT_CHARS } from "@/lib/campaigns/evidence-answers";
import { validateEvidenceUrl, validateOptionalText } from "@/lib/campaigns/validate";
import {
  countRecentSubmissionsByWallet,
  createSubmission,
  getCampaign,
  listMissions,
  listSlotClaimants,
  recordEvent,
} from "@/lib/db/campaigns";
import { getRecipientWallet, listInvitedCampaignIds } from "@/lib/db/recipient-wallets";
import {
  buildEvidenceClaimTypedData,
  computeEvidenceDigest,
  verifyEvidenceClaim,
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  EVIDENCE_CLAIM_TTL_SECONDS,
  type EvidenceClaim,
} from "@/lib/campaigns/evidence-claim";
import { missionSlotStatus } from "@/lib/campaigns/slot-reservation";
import { signTypedDataViaPrivy, type PrivyTypedData } from "@/lib/privy/client";
import { nowSeconds } from "@/lib/db/keys";
import { short } from "@/lib/format";
import type { Mission } from "@/lib/db/schema";
import { hasMissionPlan } from "./vault-kind";
import { normalizeForChain, sameChainAddress } from "./chain-address";

/**
 * WALLETLESS RECIPIENT submission — proof sent IN CHAT (move 2 of the pivot).
 *
 * This MIRRORS the web submit route's V2 branch, in the same order, using the SAME primitives:
 * SSRF-validated evidence, active-mission check, allowlist gate, slot status, the EIP-712 evidence
 * claim, the daily cap, `createSubmission`, the journal event. The ONE difference is who holds the
 * pen: the recipient's Privy server wallet signs the SAME typed data every web tester signs
 * (`signTypedDataViaPrivy`, proven live to recover under viem), and the SAME `verifyEvidenceClaim`
 * then verifies it — so "a payout only ever reaches a wallet that proved control" stays one
 * invariant with one verifier, not a bypass. Kept as a parallel composer rather than a refactor of
 * the live route so the path real web testers use tonight is untouched; the mirroring is explicit
 * and both cite each other.
 *
 * Deliberately NARROWER than the route (fails closed, never wider):
 *  - V2 campaigns only (every direct campaign is V2).
 *  - No observation missions (structurally absent from direct campaigns) → no revise loop.
 *  - The recipient must be on the campaign's allowlist via a redeemed invite, or the campaign open.
 */

const SUBMIT_DAILY_LIMIT = Math.max(1, Number(process.env.SUBMIT_DAILY_LIMIT) || 5);
const ONE_DAY_SECONDS = 24 * 60 * 60;

export interface RecipientSubmitInput {
  chatId: string;
  /** optional explicit campaign; else the recipient's single invited campaign is used. */
  campaignId?: string;
  /** optional explicit mission key; else the one open mission they can still be paid for. */
  missionKey?: string;
  evidenceUrl?: string;
  note?: string;
}

export type RecipientSubmitResult =
  | { ok: true; submissionId: string; campaignId: string; missionTitle: string; rewardUsd: number }
  | { ok: false; error: string };

interface Deps {
  signTypedData?: (walletId: string, td: PrivyTypedData) => Promise<`0x${string}`>;
  now?: () => number;
}

/** The typed data the web tester's browser wallet builds — identical here, via Privy. */
function toPrivyTypedData(claim: EvidenceClaim): PrivyTypedData {
  const td = buildEvidenceClaimTypedData(claim);
  return {
    domain: td.domain as unknown as Record<string, unknown>,
    types: {
      // Privy requires EIP712Domain listed; viem's recovery ignores it — signatures agree (proven live).
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      EvidenceClaim: td.types.EvidenceClaim as unknown as { name: string; type: string }[],
    },
    primary_type: "EvidenceClaim",
    // bigints → decimal strings for JSON transport; EIP-712 hashing treats them identically.
    message: Object.fromEntries(
      Object.entries(td.message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
    ),
  };
}

export async function submitAsRecipient(input: RecipientSubmitInput, deps: Deps = {}): Promise<RecipientSubmitResult> {
  const rw = getRecipientWallet(input.chatId);
  if (!rw) return { ok: false, error: "This chat has no Sage wallet yet — open your invite link first." };
  const wallet = rw.address;

  // ── which campaign ────────────────────────────────────────────────────────
  const invited = listInvitedCampaignIds(wallet);
  const campaignId = input.campaignId ?? (invited.length === 1 ? invited[0] : undefined);
  if (!campaignId) {
    return {
      ok: false,
      error:
        invited.length === 0
          ? "You're not invited to any campaign yet — ask the funder for your invite link."
          : "You're invited to more than one campaign — say which one this proof is for.",
    };
  }
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, error: "That campaign doesn't exist." };
  if (campaign.status !== "live") return { ok: false, error: "That campaign isn't accepting submissions right now." };
  // An invited recipient submits against a mission plan; which chain pays is settled later.
  if (!hasMissionPlan(campaign.vaultKind) || !campaign.campaignIdHash) {
    return { ok: false, error: "That campaign can't take chat submissions." };
  }
  /**
   * The SAME allowlist gate the web submit route enforces.
   *
   * Membership was a raw string match. A Starknet address has many spellings differing only in
   * leading zeros, so an invited recipient would be refused from the very grant they were named
   * on — the failure landing on the person who did the work, not on the founder who set it up.
   */
  if (
    Array.isArray(campaign.allowlist) &&
    campaign.allowlist.length > 0 &&
    !campaign.allowlist.some((a) => sameChainAddress(a, wallet))
  ) {
    return { ok: false, error: "Your wallet isn't on this campaign's recipient list — open your invite link first." };
  }

  // ── which mission ─────────────────────────────────────────────────────────
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const active = listMissions(campaignId).filter((m: Mission) => m.status === "active");
  const openOnes = active.filter((m) => {
    const slots = missionSlotStatus(listSlotClaimants(m.missionIdHash), m.maxCompletions, nowSeconds());
    return slots.open > 0;
  });
  const mission = input.missionKey ? active.find((m) => m.missionKey === input.missionKey) : openOnes[0];
  if (!mission) return { ok: false, error: "No open milestone is left on this campaign." };
  if (mission.verifiabilityClass === "observation-based") {
    return { ok: false, error: "This milestone needs the web board — chat submission isn't available for it." };
  }
  {
    const slots = missionSlotStatus(listSlotClaimants(mission.missionIdHash), mission.maxCompletions, nowSeconds());
    if (slots.open <= 0) return { ok: false, error: "That milestone has no open slots left." };
  }
  // FAIL CLOSED on an incomplete mission record: the spec digest is part of what the claim signs;
  // a bare "0x" is not a bytes32 and a missing digest means the row never locked properly.
  if (!mission.specDigest || !/^0x[0-9a-fA-F]{64}$/.test(mission.specDigest)) {
    return { ok: false, error: "This milestone's record is incomplete — the operator should re-check the campaign." };
  }

  // ── evidence, exactly as the route validates it ───────────────────────────
  let evidenceUrl: string | null = null;
  if (input.evidenceUrl != null && input.evidenceUrl !== "") {
    const ev = validateEvidenceUrl(input.evidenceUrl);
    if (!ev.ok) return { ok: false, error: ev.error };
    evidenceUrl = ev.value;
  }
  const note = validateOptionalText(input.note, "Note", MAX_ACCOUNT_CHARS);
  if (!note.ok) return { ok: false, error: note.error };
  if (!evidenceUrl && !(note.value ?? "").trim()) {
    return { ok: false, error: "Send the link to your work (or the transaction hash) so Sage can verify it." };
  }

  // ── the SAME EIP-712 claim every web tester signs — signed by their Privy wallet ──
  const issuedAt = now();
  const claim: EvidenceClaim = {
    schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
    publicCampaignId: campaignId,
    campaignIdHash: campaign.campaignIdHash as `0x${string}`,
    missionKey: mission.missionKey,
    missionIdHash: mission.missionIdHash as `0x${string}`,
    missionSpecDigest: mission.specDigest as `0x${string}`,
    evidenceDigest: computeEvidenceDigest({ evidenceUrl: evidenceUrl ?? "", note: note.value ?? "" }),
    // Chain-aware: viem rejects a felt outright, so an invited Starknet recipient could not
    // submit at all — the claim was built before anything else could go wrong.
    tester: normalizeForChain(wallet, campaign.chainId ?? 59902) as `0x${string}`,
    chainId: campaign.chainId ?? 59902,
    nonce: `rcp-${input.chatId}-${mission.missionKey}-${issuedAt}`,
    issuedAt,
    expiry: issuedAt + EVIDENCE_CLAIM_TTL_SECONDS,
  };
  let signature: `0x${string}`;
  try {
    signature = await (deps.signTypedData ?? signTypedDataViaPrivy)(rw.privyWalletId, toPrivyTypedData(claim));
  } catch (err) {
    console.error("[recipient-submit] privy sign failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't sign your submission just now — try again in a moment." };
  }
  const verdict = await verifyEvidenceClaim(claim, signature, {
    expectedWallet: wallet as `0x${string}`,
    chainId: campaign.chainId ?? 59902,
    now: now(),
    evidenceDigest: claim.evidenceDigest,
  });
  if (!verdict.ok) return { ok: false, error: `Signature rejected (${verdict.reason}).` };

  // ── the SAME daily cap ────────────────────────────────────────────────────
  if (countRecentSubmissionsByWallet(campaignId, wallet, now() - ONE_DAY_SECONDS) >= SUBMIT_DAILY_LIMIT) {
    return { ok: false, error: `Daily submission limit reached (${SUBMIT_DAILY_LIMIT}/day) — try again tomorrow.` };
  }

  const result = createSubmission({
    campaignId,
    wallet,
    evidenceUrl,
    note: note.value || null,
    missionIdHash: mission.missionIdHash,
    missionSpecDigest: mission.specDigest ?? null,
  });
  if (!result.ok) {
    const msg =
      result.error === "duplicate_wallet"
        ? "You've already submitted to this milestone — Sage is on it."
        : "That submission couldn't be recorded — it may duplicate an earlier one.";
    return { ok: false, error: msg };
  }
  recordEvent({
    campaignId,
    submissionId: result.submission.id,
    kind: "submission_received",
    detail: `${short(wallet)} · via chat`,
  });
  return {
    ok: true,
    submissionId: result.submission.id,
    campaignId,
    missionTitle: mission.title,
    rewardUsd: mission.rewardAmount / 1_000_000,
  };
}
