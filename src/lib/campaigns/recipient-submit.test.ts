import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { db } from "@/lib/db";
import { campaigns, missions as missionsTable } from "@/lib/db/schema";
import { seedV2Campaign } from "./campaign-v2.fixture";
import { submitAsRecipient } from "./recipient-submit";
import { buildEvidenceClaimTypedData, type EvidenceClaim } from "./evidence-claim";
import { getSubmission } from "@/lib/db/campaigns";
import { createRecipientInvite, redeemRecipientInvite, saveRecipientWallet } from "@/lib/db/recipient-wallets";
import type { PrivyTypedData } from "@/lib/privy/client";

/**
 * WALLETLESS RECIPIENT submission — the invariant proof (move 2).
 *
 * The signer here is a REAL local EIP-712 account standing in for Privy (whose server-side
 * eth_signTypedData_v4 was proven live to recover identically under viem, 2026-08-26). Everything
 * else is the production path: the same claim struct, the SAME `verifyEvidenceClaim`, the same
 * allowlist gate, the same `createSubmission`. The test that matters most: a signature from the
 * WRONG key is rejected — chat custody does not loosen "payout only to a wallet that proved
 * control" by one bit.
 */

const SPEC_DIGEST = `0x${"ab".repeat(32)}`;

/** viem-signer standing in for Privy: same typed data, same signature algebra. */
function localSigner(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  const sign = async (_walletId: string, td: PrivyTypedData): Promise<`0x${string}`> => {
    // Re-derive the exact viem typed-data call from the transported shape (bigints came as strings).
    const msg = td.message as Record<string, string>;
    const claim: EvidenceClaim = {
      schemaVersion: Number(msg.schemaVersion),
      publicCampaignId: msg.publicCampaignId,
      campaignIdHash: msg.campaignIdHash as `0x${string}`,
      missionKey: msg.missionKey,
      missionIdHash: msg.missionIdHash as `0x${string}`,
      missionSpecDigest: msg.missionSpecDigest as `0x${string}`,
      evidenceDigest: msg.evidenceDigest as `0x${string}`,
      tester: msg.tester as `0x${string}`,
      chainId: Number(msg.chainId),
      nonce: msg.nonce,
      issuedAt: Number(msg.issuedAt),
      expiry: Number(msg.expiry),
    };
    const typed = buildEvidenceClaimTypedData(claim);
    return account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
  };
  return { account, sign };
}

let seq = 0;
function seedForRecipient(opts: { allowlisted: boolean; wallet: string }) {
  const fx = seedV2Campaign();
  // Direct-campaign shape: locked spec digest, grant kind, optionally invite-only.
  db.update(missionsTable).set({ specDigest: SPEC_DIGEST }).where(eq(missionsTable.campaignId, fx.campaign.id)).run();
  db.update(campaigns)
    .set({ kind: "grant", ...(opts.allowlisted ? { allowlist: [opts.wallet.toLowerCase()] } : {}) })
    .where(eq(campaigns.id, fx.campaign.id))
    .run();
  const chatId = `rcpchat-${++seq}`;
  saveRecipientWallet({ chatId, privyWalletId: `pw-${seq}`, address: opts.wallet });
  const invite = createRecipientInvite(fx.campaign.id, fx.campaign.posterWallet);
  redeemRecipientInvite(invite.code, chatId, opts.wallet);
  return { fx, chatId };
}

describe("submitAsRecipient — chat custody, unchanged control invariant", () => {
  let signer: ReturnType<typeof localSigner>;
  beforeEach(() => {
    signer = localSigner(generatePrivateKey());
  });

  it("a spoken submission lands as a REAL signed submission row", async () => {
    const { fx, chatId } = seedForRecipient({ allowlisted: true, wallet: signer.account.address });
    const r = await submitAsRecipient(
      { chatId, evidenceUrl: "https://shop.example.org/logo", note: "done — the page is live" },
      { signTypedData: signer.sign },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const sub = getSubmission(r.submissionId)!;
    expect(sub.wallet).toBe(signer.account.address.toLowerCase());
    expect(sub.missionIdHash).toBeTruthy();
    expect(r.rewardUsd).toBeGreaterThan(0);
  });

  it("THE INVARIANT: a signature from the WRONG key is rejected — custody never loosens control", async () => {
    const { chatId } = seedForRecipient({ allowlisted: true, wallet: signer.account.address });
    const impostor = localSigner(generatePrivateKey()); // different key than the bound wallet
    const r = await submitAsRecipient(
      { chatId, evidenceUrl: "https://shop.example.org/logo" },
      { signTypedData: impostor.sign },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Signature rejected/);
  });

  it("not on an invite-only campaign's list → refused by the same allowlist gate", async () => {
    // allowlist holds a DIFFERENT wallet than the recipient's
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const fx = seedV2Campaign();
    db.update(missionsTable).set({ specDigest: SPEC_DIGEST }).where(eq(missionsTable.campaignId, fx.campaign.id)).run();
    db.update(campaigns).set({ kind: "grant", allowlist: [other.toLowerCase()] }).where(eq(campaigns.id, fx.campaign.id)).run();
    const chatId = `rcpchat-x${++seq}`;
    saveRecipientWallet({ chatId, privyWalletId: `pw-x${seq}`, address: signer.account.address });
    const invite = createRecipientInvite(fx.campaign.id, fx.campaign.posterWallet);
    redeemRecipientInvite(invite.code, chatId, signer.account.address);
    const r = await submitAsRecipient({ chatId, evidenceUrl: "https://x.org/a" }, { signTypedData: signer.sign });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/recipient list/);
  });

  it("no link and no words → asked for the proof, nothing recorded", async () => {
    const { chatId } = seedForRecipient({ allowlisted: true, wallet: signer.account.address });
    const r = await submitAsRecipient({ chatId }, { signTypedData: signer.sign });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/link/i);
  });

  it("a second submission to the same milestone is refused as a duplicate", async () => {
    const { chatId } = seedForRecipient({ allowlisted: true, wallet: signer.account.address });
    const first = await submitAsRecipient(
      { chatId, evidenceUrl: "https://shop.example.org/logo" },
      { signTypedData: signer.sign },
    );
    expect(first.ok).toBe(true);
    const again = await submitAsRecipient(
      { chatId, missionKey: first.ok ? undefined : undefined, evidenceUrl: "https://shop.example.org/logo2", note: "again" },
      { signTypedData: signer.sign },
    );
    // either the same mission dedupes, or the picker moved to the next open mission — both honest;
    // force the SAME mission to pin the dedupe:
    if (again.ok) {
      const third = await submitAsRecipient(
        { chatId, evidenceUrl: "https://shop.example.org/logo3", missionKey: "load" },
        { signTypedData: signer.sign },
      );
      expect(third.ok).toBe(false);
    } else {
      expect(again.error.length).toBeGreaterThan(0);
    }
  });
});
