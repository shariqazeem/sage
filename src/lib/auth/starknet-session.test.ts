import { beforeEach, describe, expect, it } from "vitest";

import {
  buildSignInTypedData,
  mintSessionToken,
  normalizeStarknetAddress,
  readSessionToken,
} from "./starknet-session";

const ADDR = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

beforeEach(() => {
  process.env.SAGE_SESSION_SECRET = "test-secret-for-the-session-token";
});

describe("Starknet address normalisation", () => {
  /** Felts have no canonical padding: the same address arrives padded or not, upper or lower. */
  it("treats padded, unpadded and checksummed forms as the same address", () => {
    const a = normalizeStarknetAddress(ADDR);
    expect(normalizeStarknetAddress(ADDR.toUpperCase().replace("0X", "0x"))).toBe(a);
    expect(normalizeStarknetAddress("0x0000" + ADDR.slice(2))).toBe(a);
    expect(a).not.toMatch(/^0x0/);
  });

  it("refuses anything that is not a felt", () => {
    for (const bad of ["", "0x", "not-an-address", "0xzz", "0x" + "f".repeat(64)]) {
      expect(normalizeStarknetAddress(bad)).toBeNull();
    }
  });

  /** Padding is how addresses are usually written; refusing it would refuse to pay real people. */
  it("accepts an address padded well past 32 bytes", () => {
    const a = normalizeStarknetAddress(ADDR);
    expect(normalizeStarknetAddress("0x" + "0".repeat(20) + ADDR.slice(2))).toBe(a);
  });

  /** An EVM address IS a valid felt by shape. That is fine — what matters is it round-trips. */
  it("accepts an EVM-shaped address as a felt without corrupting it", () => {
    const evm = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
    expect(normalizeStarknetAddress(evm)).toBe(evm);
  });
});

describe("the sign-in message", () => {
  /**
   * A Starknet wallet DISPLAYS typed data to the person approving it, so the copy has to say
   * plainly that it authorises nothing. Someone reading this in their wallet is the last line of
   * defence against signing something else entirely.
   */
  it("tells the signer it moves no funds", () => {
    const td = buildSignInTypedData({ address: ADDR, nonce: "abc", issuedAt: 1_756_000_000 });
    expect(td.message.statement).toMatch(/moves no funds/i);
    expect(td.primaryType).toBe("SignIn");
  });

  it("binds the wallet, the nonce and the time", () => {
    const base = { address: ADDR, nonce: "abc", issuedAt: 1_756_000_000 };
    const a = JSON.stringify(buildSignInTypedData(base));
    expect(a).not.toBe(JSON.stringify(buildSignInTypedData({ ...base, nonce: "xyz" })));
    expect(a).not.toBe(JSON.stringify(buildSignInTypedData({ ...base, issuedAt: 1 })));
    expect(a).not.toBe(JSON.stringify(buildSignInTypedData({ ...base, address: "0x1" })));
  });
});

describe("the session token", () => {
  const NOW = 1_756_000_000_000;

  it("round-trips a signed address", () => {
    expect(readSessionToken(mintSessionToken(ADDR, NOW), NOW + 1000)).toBe(
      normalizeStarknetAddress(ADDR),
    );
  });

  /**
   * THE TEST THAT MAKES THE COOKIE WORTH ANYTHING. Without the HMAC check, anyone could hand
   * themselves a session for any address — and the payout address comes from the session.
   */
  it("rejects a token whose address was swapped", () => {
    const token = mintSessionToken(ADDR, NOW);
    const [encoded, sig] = token.split(".");
    const forgedPayload = Buffer.from(`0xdeadbeef.${NOW}`).toString("base64url");
    expect(readSessionToken(`${forgedPayload}.${sig}`, NOW + 1000)).toBeNull();
    expect(encoded).toBeTruthy();
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintSessionToken(ADDR, NOW);
    process.env.SAGE_SESSION_SECRET = "a-completely-different-secret";
    expect(readSessionToken(token, NOW + 1000)).toBeNull();
  });

  it("expires", () => {
    const token = mintSessionToken(ADDR, NOW);
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    expect(readSessionToken(token, NOW + eightDays)).toBeNull();
  });

  /** An auth check that throws is one that can be turned into a denial of service. */
  it("reads garbage as logged-out rather than throwing", () => {
    for (const junk of ["", ".", "a.b", "not-a-token", "!!!.???", "x".repeat(500)]) {
      expect(() => readSessionToken(junk, NOW)).not.toThrow();
      expect(readSessionToken(junk, NOW)).toBeNull();
    }
  });
});
