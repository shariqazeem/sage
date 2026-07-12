import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Hex } from "viem";
import { buildClaimTypedData, verifyClaimSignature, CLAIM_SCHEMA_VERSION, type PlanClaim } from "./claim";

/**
 * The claim is the security boundary between an anonymous inspection and a wallet-owned
 * deployment. These tests do REAL ECDSA signing + recovery (viem accounts) — not mocks —
 * so a passing suite means the actual signature path binds wallet→plan and rejects every
 * substitution: wrong wallet, stale plan, expired window, wrong chain, replay of a
 * tampered field.
 */

// Deterministic throwaway test keys (well-known viem/anvil vectors — NOT secrets).
const FOUNDER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const ATTACKER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const NOW = 1_800_000_000;
function claim(over: Partial<PlanClaim> = {}): PlanClaim {
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    inspectionId: "insp_abc123",
    approvedRevision: 3,
    publicCampaignId: "acme-onboarding-audit",
    campaignIdHash: `0x${"a".repeat(64)}` as Hex,
    missionPlanDigest: `0x${"b".repeat(64)}` as Hex,
    totalBudgetBase: "6000000",
    founder: FOUNDER.address,
    chainId: 59902,
    nonce: "n_deadbeef",
    issuedAt: NOW,
    expiry: NOW + 600,
    ...over,
  };
}

async function sign(c: PlanClaim, who = FOUNDER): Promise<Hex> {
  return who.signTypedData(buildClaimTypedData(c));
}

const ctx = (over: Partial<{ expectedWallet: Hex; chainId: number; now: number }> = {}) => ({
  expectedWallet: FOUNDER.address,
  chainId: 59902,
  now: NOW + 1,
  ...over,
});

describe("claim — a correctly signed claim binds the founder wallet to the plan", () => {
  it("accepts the founder's own signature over the approved plan", async () => {
    const c = claim();
    const sig = await sign(c);
    const v = await verifyClaimSignature(c, sig, ctx());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.founder).toBe(getAddress(FOUNDER.address));
  });
});

describe("claim — an anonymous / wrong wallet cannot claim another browser's plan", () => {
  it("rejects a signature from a different wallet than the claim's founder", async () => {
    const c = claim(); // founder = FOUNDER
    const sig = await sign(c, ATTACKER); // but ATTACKER signed it
    const v = await verifyClaimSignature(c, sig, ctx());
    expect(v).toEqual({ ok: false, reason: "wallet_mismatch" });
  });

  it("rejects when the session wallet differs from the recovered signer", async () => {
    const c = claim();
    const sig = await sign(c); // FOUNDER signs their own claim
    // ...but the server session belongs to ATTACKER.
    const v = await verifyClaimSignature(c, sig, ctx({ expectedWallet: ATTACKER.address }));
    expect(v).toEqual({ ok: false, reason: "wallet_mismatch" });
  });
});

describe("claim — the signature is bound to every field (tamper → invalid)", () => {
  it("rejects if the budget is changed after signing", async () => {
    const signed = claim({ totalBudgetBase: "6000000" });
    const sig = await sign(signed);
    const tampered = { ...signed, totalBudgetBase: "9000000" }; // attacker inflates the budget
    const v = await verifyClaimSignature(tampered, sig, ctx());
    expect(v.ok).toBe(false); // recovered signer no longer matches
  });

  it("rejects if the campaign identity hash is swapped after signing", async () => {
    const signed = claim();
    const sig = await sign(signed);
    const tampered = { ...signed, campaignIdHash: `0x${"c".repeat(64)}` as Hex };
    const v = await verifyClaimSignature(tampered, sig, ctx());
    expect(v.ok).toBe(false);
  });

  it("rejects if the approved revision is bumped after signing", async () => {
    const signed = claim({ approvedRevision: 3 });
    const sig = await sign(signed);
    const tampered = { ...signed, approvedRevision: 4 };
    const v = await verifyClaimSignature(tampered, sig, ctx());
    expect(v.ok).toBe(false);
  });
});

describe("claim — time + domain bounds", () => {
  it("rejects an expired claim", async () => {
    const c = claim();
    const sig = await sign(c);
    const v = await verifyClaimSignature(c, sig, ctx({ now: c.expiry + 1 }));
    expect(v).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a claim whose issuedAt is in the future (clock-skew guarded to 60s)", async () => {
    const c = claim({ issuedAt: NOW + 3600, expiry: NOW + 7200 });
    const sig = await sign(c);
    const v = await verifyClaimSignature(c, sig, ctx({ now: NOW }));
    expect(v).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects a claim signed for a different chain", async () => {
    const c = claim({ chainId: 1 }); // signed for mainnet
    const sig = await sign(c);
    const v = await verifyClaimSignature(c, sig, ctx({ chainId: 59902 }));
    expect(v).toEqual({ ok: false, reason: "wrong_chain" });
  });

  it("rejects an unknown schema version", async () => {
    const c = claim({ schemaVersion: 99 });
    const sig = await sign(c);
    const v = await verifyClaimSignature(c, sig, ctx());
    expect(v).toEqual({ ok: false, reason: "schema" });
  });
});

describe("claim — malformed signature bytes never throw", () => {
  it("returns bad_signature for garbage bytes", async () => {
    const c = claim();
    const v = await verifyClaimSignature(c, "0xdeadbeef" as Hex, ctx());
    expect(v.ok).toBe(false);
  });
});
