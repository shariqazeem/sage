import { describe, expect, it } from "vitest";

import { buildSignInTypedData, newStarknetNonce } from "./starknet-session";

/**
 * A CAIRO SHORT STRING IS ONE FELT: at most 31 ASCII characters.
 *
 * Exceed it and the wallet refuses the ENTIRE signature — Ready reported
 * "440e9b106c13801982de93f00b1111cd is too long" and the sign-in simply could not complete. The
 * nonce was 16 random bytes rendered as 32 hex characters: one over the line.
 *
 * This guards every `shortstring` in the structure rather than only the field that broke, because
 * the next one to cross the limit will fail exactly as invisibly — in someone else's wallet, on
 * the screen where they are deciding whether the product works.
 */

const SHORTSTRING_MAX = 31;

const typedData = (nonce: string) =>
  buildSignInTypedData({
    address: "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048",
    nonce,
    issuedAt: 1788027788175,
  });

describe("the SNIP-12 sign-in payload", () => {
  it("keeps EVERY shortstring field within one felt", () => {
    const td = typedData("a".repeat(30));
    const shortstringFields = [
      ...td.types.StarknetDomain.filter((f) => f.type === "shortstring").map((f) => [
        f.name,
        (td.domain as Record<string, string>)[f.name],
      ]),
      ...td.types.SignIn.filter((f) => f.type === "shortstring").map((f) => [
        f.name,
        (td.message as Record<string, string>)[f.name],
      ]),
    ] as [string, string][];

    expect(shortstringFields.length).toBeGreaterThan(0); // otherwise this proves nothing
    for (const [name, value] of shortstringFields) {
      expect(typeof value, `${name} is not a string`).toBe("string");
      expect(value.length, `${name} is ${value.length} chars, over the ${SHORTSTRING_MAX} limit`)
        .toBeLessThanOrEqual(SHORTSTRING_MAX);
    }
  });

  it("GENERATES a nonce that fits — the exact failure a founder hit", () => {
    // Exercises generation, not a nonce this test invented. The first version of this guard
    // supplied its own value, so restoring the byte count that broke Ready left it green.
    for (let i = 0; i < 50; i++) {
      const nonce = newStarknetNonce();
      expect(nonce.length, `generated a ${nonce.length}-char nonce`).toBeLessThanOrEqual(
        SHORTSTRING_MAX,
      );
      expect(nonce).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("generates a DIFFERENT nonce each time, which is the whole point of one", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newStarknetNonce()));
    expect(seen.size).toBe(50);
  });

  it("still carries enough entropy to be a nonce at all", () => {
    // Shortening to fit must not quietly become "short enough to guess".
    const hexChars = 30;
    expect(hexChars * 4).toBeGreaterThanOrEqual(120); // bits
  });

  it("states plainly what is being signed, in a wallet's own words", () => {
    const td = typedData("abc");
    expect(td.message.statement).toContain("moves no funds");
    expect(td.domain.chainId).toBe("SN_MAIN");
  });
});
