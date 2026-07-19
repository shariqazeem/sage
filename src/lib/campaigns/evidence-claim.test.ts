import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Hex } from "viem";
import {
  buildEvidenceClaimTypedData,
  verifyEvidenceClaim,
  computeEvidenceDigest,
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  type EvidenceClaim,
} from "./evidence-claim";

/**
 * The evidence claim is the tester security boundary: a payout may only reach the wallet
 * that signed, and the evidence cannot be swapped after signing. Real ECDSA sign+recover
 * (viem accounts) — a passing suite means the actual path rejects a wrong wallet, tampered
 * evidence, a stale window, the wrong chain, and a signature replayed onto another mission.
 */

const TESTER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const ATTACKER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const NOW = 1_800_000_000;
const EV = { evidenceUrl: "https://yara.garden/proof", note: "found the CTA in the hero" };
const DIGEST = computeEvidenceDigest(EV);

function claim(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
    publicCampaignId: "launch-yara-garden-2jaek9",
    campaignIdHash: `0x${"a".repeat(64)}` as Hex,
    missionKey: "yara-navigation-and-cta-discovery",
    missionIdHash: `0x${"b".repeat(64)}` as Hex,
    missionSpecDigest: `0x${"c".repeat(64)}` as Hex,
    evidenceDigest: DIGEST,
    tester: TESTER.address,
    chainId: 59902,
    nonce: "n_deadbeef",
    issuedAt: NOW,
    expiry: NOW + 600,
    ...over,
  };
}
const sign = (c: EvidenceClaim, who = TESTER) => who.signTypedData(buildEvidenceClaimTypedData(c));
const ctx = (over: Partial<{ expectedWallet: Hex; chainId: number; now: number; evidenceDigest: Hex }> = {}) => ({
  expectedWallet: TESTER.address, chainId: 59902, now: NOW + 1, evidenceDigest: DIGEST, ...over,
});

describe("evidence-claim — a correctly signed claim binds the tester to their evidence", () => {
  it("accepts the tester's own signature over the exact evidence", async () => {
    const c = claim();
    const v = await verifyEvidenceClaim(c, await sign(c), ctx());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.tester).toBe(getAddress(TESTER.address));
  });
  it("computeEvidenceDigest is stable + content-bound", () => {
    expect(computeEvidenceDigest(EV)).toBe(DIGEST);
    expect(computeEvidenceDigest({ ...EV, note: "different" })).not.toBe(DIGEST);
  });
  it("canonicalizes the URL so a bare domain (client-signed) and its trailing-slash form (server) agree", () => {
    // The client hashes the raw string the tester typed; the server hashes validateEvidenceUrl()'s
    // canonical form (new URL().toString() appends the slash). Both MUST yield the same digest, else a
    // bare-domain link is rejected as evidence_mismatch at submit — the bug this fixes.
    expect(computeEvidenceDigest({ evidenceUrl: "https://yara.garden", note: "n" })).toBe(
      computeEvidenceDigest({ evidenceUrl: "https://yara.garden/", note: "n" }),
    );
  });
  it("a bare-domain link signed on the client verifies against the server's canonical digest", async () => {
    const signed = computeEvidenceDigest({ evidenceUrl: "https://yara.garden", note: "arrival felt gentle" });
    const server = computeEvidenceDigest({ evidenceUrl: new URL("https://yara.garden").toString(), note: "arrival felt gentle" });
    const c = claim({ evidenceDigest: signed });
    expect((await verifyEvidenceClaim(c, await sign(c), ctx({ evidenceDigest: server }))).ok).toBe(true);
  });
});

describe("evidence-claim — no arbitrary payout wallet, no evidence swap", () => {
  it("rejects a signature from a different wallet", async () => {
    const c = claim();
    const v = await verifyEvidenceClaim(c, await sign(c, ATTACKER), ctx());
    expect(v).toEqual({ ok: false, reason: "wallet_mismatch" });
  });
  it("rejects when the session wallet differs from the signer", async () => {
    const c = claim();
    const v = await verifyEvidenceClaim(c, await sign(c), ctx({ expectedWallet: ATTACKER.address }));
    expect(v).toEqual({ ok: false, reason: "wallet_mismatch" });
  });
  it("rejects evidence changed after signing (server digest ≠ signed digest)", async () => {
    const c = claim();
    const sig = await sign(c);
    const tamperedDigest = computeEvidenceDigest({ ...EV, note: "swapped after signing" });
    const v = await verifyEvidenceClaim(c, sig, ctx({ evidenceDigest: tamperedDigest }));
    expect(v).toEqual({ ok: false, reason: "evidence_mismatch" });
  });
  it("rejects a claim whose evidenceDigest field was tampered post-signing", async () => {
    const signed = claim();
    const sig = await sign(signed);
    const tampered = { ...signed, evidenceDigest: `0x${"9".repeat(64)}` as Hex };
    const v = await verifyEvidenceClaim(tampered, sig, ctx({ evidenceDigest: tampered.evidenceDigest }));
    expect(v.ok).toBe(false); // recovered signer no longer matches
  });
});

describe("evidence-claim — mission + time + domain bounds", () => {
  it("rejects a signature replayed onto a different mission", async () => {
    const signed = claim({ missionKey: "yara-navigation-and-cta-discovery" });
    const sig = await sign(signed);
    const tampered = { ...signed, missionKey: "yara-value-proposition-clarity", missionIdHash: `0x${"d".repeat(64)}` as Hex };
    const v = await verifyEvidenceClaim(tampered, sig, ctx());
    expect(v.ok).toBe(false);
  });
  it("rejects an expired claim", async () => {
    const c = claim();
    const v = await verifyEvidenceClaim(c, await sign(c), ctx({ now: c.expiry + 1 }));
    expect(v).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects a claim signed for a different chain", async () => {
    const c = claim({ chainId: 1 });
    const v = await verifyEvidenceClaim(c, await sign(c), ctx({ chainId: 59902 }));
    expect(v).toEqual({ ok: false, reason: "wrong_chain" });
  });
  it("rejects an unknown schema version", async () => {
    const c = claim({ schemaVersion: 99 });
    const v = await verifyEvidenceClaim(c, await sign(c), ctx());
    expect(v).toEqual({ ok: false, reason: "schema" });
  });
  it("returns bad_signature for garbage bytes", async () => {
    const v = await verifyEvidenceClaim(claim(), "0xdeadbeef" as Hex, ctx());
    expect(v.ok).toBe(false);
  });
});
