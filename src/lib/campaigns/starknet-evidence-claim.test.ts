import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHAT THE SIGNATURE ON A STARKNET SUBMISSION IS FOR.
 *
 * It binds THIS wallet to THIS evidence for THIS mission. Without it, evidence could be swapped
 * after signing, and a signature could be replayed onto a different mission in the same campaign —
 * both of which end with the vault paying for work nobody did.
 *
 * A Starknet account is a CONTRACT, so there is no address to recover to: the account itself
 * decides, via `is_valid_signature`. Until now the submit route refused mission-bound work on this
 * rail rather than ship a weaker guarantee — the honest call, and it also meant a funded vault
 * that WOULD pay could never receive a submission at all.
 */

const verifyMessageInStarknet = vi.fn(async () => true);
const getClassHashAt = vi.fn(async () => "0x123");

vi.mock("server-only", () => ({}));
vi.mock("starknet", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    RpcProvider: class {
      getClassHashAt = (...a: unknown[]) => getClassHashAt(...(a as []));
    },
    verifyMessageInStarknet: (...a: unknown[]) => verifyMessageInStarknet(...(a as [])),
  };
});
vi.mock("@/lib/starknet/config", () => ({
  starknetAddresses: () => ({ rpcUrl: "https://rpc.test", claims: "0x1", token: "0x2" }),
}));

import { EVIDENCE_CLAIM_SCHEMA_VERSION, type EvidenceClaim } from "./evidence-claim";
import { verifyStarknetEvidenceClaim } from "./starknet-evidence-claim";
import {
  EVIDENCE_STATEMENT,
  buildStarknetEvidenceTypedData,
} from "./starknet-evidence-typed-data";

const WALLET = "0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434";
const NORMALISED = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const DIGEST = "0x39c8721bf3388ef78c49a7a69c2eaa0f74e51f6c21cafad763f1734a5c8a347d";
const NOW = 1_788_000_000;

const claim = (over: Partial<EvidenceClaim> = {}): EvidenceClaim =>
  ({
    schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
    publicCampaignId: "launch-starkscan-co-s2k7yd",
    campaignIdHash: "0xaa" + "1".repeat(62),
    missionKey: "contract-token-transfers-tab",
    missionIdHash: DIGEST,
    missionSpecDigest: "0xbb" + "2".repeat(62),
    evidenceDigest: "0xcc" + "3".repeat(62),
    tester: WALLET,
    chainId: 900_001,
    nonce: "n_1",
    issuedAt: NOW - 30,
    expiry: NOW + 600,
    ...over,
  }) as unknown as EvidenceClaim;

const ctx = (over: Partial<{ expectedWallet: string; now: number; evidenceDigest: string }> = {}) => ({
  expectedWallet: WALLET,
  now: NOW,
  evidenceDigest: "0xcc" + "3".repeat(62),
  ...over,
});

beforeEach(() => {
  verifyMessageInStarknet.mockClear().mockResolvedValue(true);
  getClassHashAt.mockClear().mockResolvedValue("0x123");
});

describe("the typed data a Starknet wallet is asked to sign", () => {
  it("shows a statement that fits a Cairo shortstring", () => {
    // 31 ASCII characters is one felt. Ready refuses the whole signature if it is longer, which is
    // how the sign-in nonce broke: the failure is at the wallet, not in a log.
    expect(EVIDENCE_STATEMENT.length).toBeLessThanOrEqual(31);
    expect(EVIDENCE_STATEMENT).toMatch(/^[\x20-\x7e]+$/);
  });

  it("signs only felts — never the public campaign id, which can exceed a shortstring", () => {
    const t = buildStarknetEvidenceTypedData(claim(), WALLET);
    expect(Object.values(t.message).join(" ")).not.toContain("starkscan");
    for (const [k, v] of Object.entries(t.message)) {
      if (k === "statement") continue;
      expect(BigInt(v as string) < (BigInt(1) << BigInt(252)), `${k} must fit a felt`).toBe(true);
    }
  });

  it("reduces a 256-bit hash the SAME way the vault is keyed", () => {
    const t = buildStarknetEvidenceTypedData(claim(), WALLET);
    // 0x39c8… is 256 bits; the vault knows this mission as 0x1c8721…, and so must the signature.
    expect(BigInt(t.message.mission as string)).toBe(
      BigInt("0x1c8721bf3388ef78c49a7a69c2eaa0f74e51f6c21cafad763f1734a5c8a347d"),
    );
  });

  it("binds the wallet, the mission, and the evidence together", () => {
    const t = buildStarknetEvidenceTypedData(claim(), WALLET);
    expect(BigInt(t.message.wallet as string)).toBe(BigInt(NORMALISED));
    expect(t.types.EvidenceCommitment.map((f: { name: string }) => f.name)).toEqual([
      "statement", "wallet", "campaign", "mission", "missionSpec", "evidence", "issuedAt", "expiry",
    ]);
  });

  it("changes when ANY bound field changes — that is the whole guarantee", () => {
    const base = JSON.stringify(buildStarknetEvidenceTypedData(claim(), WALLET).message);
    const variants: Partial<Record<keyof EvidenceClaim, unknown>>[] = [
      { evidenceDigest: "0xdd" + "4".repeat(62) },
      { missionIdHash: "0xee" + "5".repeat(62) },
      { campaignIdHash: "0xff" + "6".repeat(62) },
      { missionSpecDigest: "0x11" + "7".repeat(62) },
      { expiry: NOW + 601 },
    ];
    for (const v of variants) {
      expect(JSON.stringify(buildStarknetEvidenceTypedData(claim(v as Partial<EvidenceClaim>), WALLET).message)).not.toBe(base);
    }
  });
});

describe("verifying a Starknet evidence commitment", () => {
  it("accepts a signature the recipient's own account contract says is valid", async () => {
    const v = await verifyStarknetEvidenceClaim(claim(), ["0x1", "0x2"], ctx());
    expect(v).toEqual({ ok: true, tester: NORMALISED });
    expect(verifyMessageInStarknet).toHaveBeenCalledTimes(1);
  });

  it("REFUSES when the account contract says the signature is not valid", async () => {
    verifyMessageInStarknet.mockResolvedValue(false);
    expect(await verifyStarknetEvidenceClaim(claim(), ["0x1"], ctx())).toEqual({
      ok: false, reason: "bad_signature",
    });
  });

  it("refuses evidence swapped after signing", async () => {
    // The server computes the digest from what was actually submitted; if it disagrees with the
    // signed one, the content changed after the wallet approved it.
    const v = await verifyStarknetEvidenceClaim(claim(), ["0x1"], ctx({ evidenceDigest: "0x99" + "0".repeat(62) }));
    expect(v).toEqual({ ok: false, reason: "evidence_mismatch" });
    expect(verifyMessageInStarknet).not.toHaveBeenCalled();
  });

  it("refuses a claim signed for a different wallet than the session's", async () => {
    const other = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
    expect(await verifyStarknetEvidenceClaim(claim({ tester: other } as never), ["0x1"], ctx())).toEqual({
      ok: false, reason: "wallet_mismatch",
    });
  });

  it("treats the same felt written with and without leading zeros as one wallet", async () => {
    // A Starknet wallet may hand back either spelling; string equality would admit a recipient on
    // Monday and lock them out on Tuesday.
    const v = await verifyStarknetEvidenceClaim(claim({ tester: NORMALISED } as never), ["0x1"], ctx());
    expect(v.ok).toBe(true);
  });

  it("refuses an expired claim, and one issued in the future", async () => {
    expect((await verifyStarknetEvidenceClaim(claim(), ["0x1"], ctx({ now: NOW + 601 }))).ok).toBe(false);
    expect(await verifyStarknetEvidenceClaim(claim({ issuedAt: NOW + 3600 }), ["0x1"], ctx())).toEqual({
      ok: false, reason: "not_yet_valid",
    });
  });

  it("refuses a schema it does not know", async () => {
    expect(await verifyStarknetEvidenceClaim(claim({ schemaVersion: 999 }), ["0x1"], ctx())).toEqual({
      ok: false, reason: "schema",
    });
  });

  it("refuses an empty or missing signature without calling the chain", async () => {
    expect(await verifyStarknetEvidenceClaim(claim(), [], ctx())).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyMessageInStarknet).not.toHaveBeenCalled();
  });

  it("names an undeployed account separately — 'try again' can never work for it", async () => {
    getClassHashAt.mockRejectedValue(new Error("Contract not found"));
    expect(await verifyStarknetEvidenceClaim(claim(), ["0x1"], ctx())).toEqual({
      ok: false, reason: "undeployed",
    });
    expect(verifyMessageInStarknet).not.toHaveBeenCalled();
  });

  it("never throws when the node is unreachable — it refuses", async () => {
    verifyMessageInStarknet.mockRejectedValue(new Error("rpc down"));
    await expect(verifyStarknetEvidenceClaim(claim(), ["0x1"], ctx())).resolves.toEqual({
      ok: false, reason: "bad_signature",
    });
  });

  it("verifies against the account contract, not against a recovered address", async () => {
    await verifyStarknetEvidenceClaim(claim(), ["0x1", "0x2"], ctx());
    const [, typed, sig, addr] = verifyMessageInStarknet.mock.calls[0] as unknown as [
      unknown, { primaryType: string }, string[], string,
    ];
    expect(typed.primaryType).toBe("EvidenceCommitment");
    expect(sig).toEqual(["0x1", "0x2"]);
    expect(addr).toBe(NORMALISED);
  });
});

/**
 * WOULD A WALLET ACTUALLY SIGN THIS?
 *
 * A malformed structure is not rejected loudly — the wallet simply refuses, which is how the
 * sign-in nonce failed ("…is too long", from Ready, with nothing on our side to explain it).
 * `getMessageHash` is the same computation the account contract verifies against, so if it can
 * hash this, the shape is one a wallet can sign and an account can check.
 *
 * These use the REAL starknet.js, not the mocked module the tests above install.
 */
describe("the typed data is one a Starknet account can actually verify", () => {
  it("hashes with starknet.js — the same computation the account contract does", async () => {
    const { typedData: td } = await vi.importActual<typeof import("starknet")>("starknet");
    const hash = td.getMessageHash(buildStarknetEvidenceTypedData(claim(), WALLET) as never, WALLET);
    expect(hash).toMatch(/^0x[0-9a-f]+$/i);
    expect(BigInt(hash)).toBeGreaterThan(BigInt(0));
  });

  it("passes starknet.js's own structural validation", async () => {
    const { typedData: td } = await vi.importActual<typeof import("starknet")>("starknet");
    expect(td.validateTypedData(buildStarknetEvidenceTypedData(claim(), WALLET) as never)).toBe(true);
  });

  it("hashes to a DIFFERENT value for a different mission — the binding is in the hash, not just the JSON", async () => {
    const { typedData: td } = await vi.importActual<typeof import("starknet")>("starknet");
    const a = td.getMessageHash(buildStarknetEvidenceTypedData(claim(), WALLET) as never, WALLET);
    const b = td.getMessageHash(
      buildStarknetEvidenceTypedData(claim({ missionIdHash: "0xee" + "5".repeat(62) } as never), WALLET) as never,
      WALLET,
    );
    expect(a).not.toBe(b);
  });

  it("hashes differently for a different signer, so one wallet's signature cannot cover another's claim", async () => {
    const { typedData: td } = await vi.importActual<typeof import("starknet")>("starknet");
    const other = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
    const a = td.getMessageHash(buildStarknetEvidenceTypedData(claim(), WALLET) as never, WALLET);
    const b = td.getMessageHash(buildStarknetEvidenceTypedData(claim(), other) as never, other);
    expect(a).not.toBe(b);
  });
});
