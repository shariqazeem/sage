import { beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  ATTESTATION_SCHEMA,
  attestationDigest,
  buildAttestation,
  signAttestation,
  verifyAttestation,
  type SignedAttestation,
} from "./attestation";
import type { CreditSignals } from "./credit";
import type { WalletRecord } from "./record";

/** A throwaway key. Never used anywhere but here. */
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ISSUER = privateKeyToAccount(TEST_KEY).address;

const record = (over: Partial<WalletRecord> = {}): WalletRecord => ({
  wallet: "0x00000000000000000000000000000000000000aa",
  totalUsd: 847.25,
  completions: 3,
  distinctCampaigns: 2,
  firstAt: 1_750_000_000,
  lastAt: 1_756_000_000,
  entries: [
    { at: 1, campaignId: "c1", campaignTitle: "A", kind: "testing", missionTitle: null, amountUsd: 500, txHash: "0xccc", proofPath: "/proof/0xccc", chainId: 2345 },
    { at: 2, campaignId: "c2", campaignTitle: "B", kind: "gig", missionTitle: null, amountUsd: 347.25, txHash: "0xaaa", proofPath: "/proof/0xaaa", chainId: 2345 },
  ],
  ...over,
});

const signals = (over: Partial<CreditSignals> = {}): CreditSignals => ({
  formulaVersion: "credit-signals-v1",
  verifiedInflowUsd: 847.25,
  completions: 3,
  distinctCampaigns: 2,
  distinctPayers: 2,
  monthsActive: 3,
  avgInflowPerActiveMonthUsd: 282.42,
  verificationPassRate: 0.75,
  decidedSubmissions: 4,
  daysSinceLastVerified: 5,
  tenureDays: 70,
  byKindUsd: { testing: 500, gig: 347.25, grant: 0 },
  inflow30dUsd: 112.5,
  inflow90dUsd: 412.5,
  completions30d: 1,
  completions90d: 3,
  topPayerShare: 0.727,
  payerConcentration: 0.6,
  ...over,
});

beforeEach(() => {
  process.env.GOAT_AGENT_PRIVATE_KEY = TEST_KEY;
});

describe("what Sage is willing to attest", () => {
  it("states the non-money signals without being asked", () => {
    const a = buildAttestation(record(), signals(), { now: 1_000 });
    expect(a.schema).toBe(ATTESTATION_SCHEMA);
    expect(a.claims.completions).toBe(3);
    expect(a.claims.distinctPayers).toBe(2);
    expect(a.claims.verificationPassRate).toBe(0.75);
    expect(a.claims.earnedAtLeastUsd).toBeUndefined();
  });

  /**
   * THE POINT OF THE WHOLE FILE. A worker who earned $847.25 proves "at least $500" — and $847.25
   * appears nowhere in what they hand over.
   */
  it("proves a floor without revealing the figure", () => {
    const a = buildAttestation(record(), signals(), { earnedAtLeastUsd: 500, now: 1_000 });
    expect(a.claims.earnedAtLeastUsd).toBe(500);
    const serialised = JSON.stringify(a);
    expect(serialised).not.toContain("847");
    expect(serialised).not.toContain("282.42");
  });

  /** An attestation nobody can be refused is worth nothing to the lender reading it. */
  it("refuses a floor the record does not support", () => {
    expect(() =>
      buildAttestation(record(), signals(), { earnedAtLeastUsd: 1000, now: 1_000 }),
    ).toThrow(/do not reach that floor/);
  });

  /** The refusal must not leak the figure it is refusing against. */
  it("does not say what they actually earned when refusing", () => {
    try {
      buildAttestation(record(), signals(), { earnedAtLeastUsd: 1000, now: 1_000 });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as Error).message).not.toContain("847");
    }
  });

  it("refuses a nonsensical floor", () => {
    for (const floor of [0, -5]) {
      expect(() => buildAttestation(record(), signals(), { earnedAtLeastUsd: floor })).toThrow(
        /positive amount/,
      );
    }
  });

  it("anchors every claim to transactions a stranger can check", () => {
    const a = buildAttestation(record(), signals(), { now: 1_000 });
    expect(a.anchors).toEqual(["0xccc", "0xaaa"]);
  });
});

describe("the digest", () => {
  /** A verifier that serialises differently must still compute the same bytes. */
  it("does not depend on anchor order", () => {
    const a = buildAttestation(record(), signals(), { now: 1_000 });
    const b = { ...a, anchors: [...a.anchors].reverse() };
    expect(attestationDigest(a)).toBe(attestationDigest(b));
  });

  it("changes when any claim changes", () => {
    const base = buildAttestation(record(), signals(), { now: 1_000 });
    const bumped = { ...base, claims: { ...base.claims, completions: 4 } };
    expect(attestationDigest(bumped)).not.toBe(attestationDigest(base));
  });

  it("distinguishes a floor from no floor", () => {
    const without = buildAttestation(record(), signals(), { now: 1_000 });
    const with500 = buildAttestation(record(), signals(), { earnedAtLeastUsd: 500, now: 1_000 });
    expect(attestationDigest(with500)).not.toBe(attestationDigest(without));
  });
});

describe("signing and verifying", () => {
  it("round-trips", async () => {
    const signed = await signAttestation(
      buildAttestation(record(), signals(), { earnedAtLeastUsd: 500, now: 1_000 }),
    );
    expect(signed.issuer).toBe(ISSUER);
    await expect(verifyAttestation(signed, ISSUER, 2_000)).resolves.toEqual({
      valid: true,
      reason: null,
    });
  });

  /** THE TEST THAT MAKES THE SIGNATURE WORTH ANYTHING: a tampered claim must not verify. */
  it("rejects a raised floor", async () => {
    const signed = await signAttestation(
      buildAttestation(record(), signals(), { earnedAtLeastUsd: 500, now: 1_000 }),
    );
    const forged: SignedAttestation = {
      ...signed,
      claims: { ...signed.claims, earnedAtLeastUsd: 5000 },
    };
    expect((await verifyAttestation(forged, ISSUER, 2_000)).valid).toBe(false);
  });

  it("rejects an inflated completion count", async () => {
    const signed = await signAttestation(buildAttestation(record(), signals(), { now: 1_000 }));
    const forged: SignedAttestation = {
      ...signed,
      claims: { ...signed.claims, completions: 99 },
    };
    expect((await verifyAttestation(forged, ISSUER, 2_000)).valid).toBe(false);
  });

  /**
   * A verifier that accepts ANY signature is checking the document is internally consistent, not
   * that Sage said it — which is the entire value of the signature.
   */
  it("rejects a valid signature from the wrong issuer", async () => {
    const other = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
    process.env.GOAT_AGENT_PRIVATE_KEY = other;
    const signed = await signAttestation(buildAttestation(record(), signals(), { now: 1_000 }));
    const v = await verifyAttestation(signed, ISSUER, 2_000);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/different issuer/);
  });

  it("rejects an expired attestation", async () => {
    const signed = await signAttestation(
      buildAttestation(record(), signals(), { now: 1_000, ttlSeconds: 60 }),
    );
    const v = await verifyAttestation(signed, ISSUER, 1_061);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("refuses to sign with no key configured", async () => {
    delete process.env.GOAT_AGENT_PRIVATE_KEY;
    await expect(
      signAttestation(buildAttestation(record(), signals(), { now: 1_000 })),
    ).rejects.toThrow(/no attestation key/);
  });
});
