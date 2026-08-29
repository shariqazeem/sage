import { describe, expect, it } from "vitest";

import {
  buildClaimToNoteActions,
  buildRefundToNoteActions,
  EXIT,
  felt,
  OPEN_NOTE_PLACEHOLDER,
} from "./strk20-actions";

const CLAIMS = "0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57";
const TOKEN = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const SECRET = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const ME = "0x0046a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";

describe("felt encoding", () => {
  /**
   * A padded felt is REJECTED while the identical value unpadded is accepted — and a "fix" that
   * adds padding is the classic way to cause the very error it looks like it should solve.
   */
  it("strips leading zeros rather than padding", () => {
    expect(felt("0x0046a17")).toBe("0x46a17");
    expect(felt("0x0")).toBe("0x0");
    expect(felt("0x00000001")).toBe("0x1");
    expect(felt(1)).toBe("0x1");
  });

  it("never emits a padded or double-prefixed felt", () => {
    for (const v of ["0x00abc", "0xabc", 2748]) {
      const out = felt(v);
      expect(out).toBe("0xabc");
      expect(out).not.toMatch(/^0x0./);
    }
  });

  it("refuses a negative value instead of wrapping it", () => {
    expect(() => felt(-1)).toThrow(/cannot be negative/);
  });
});

describe("collecting into a shielded note", () => {
  const actions = buildClaimToNoteActions({
    claims: CLAIMS,
    token: TOKEN,
    secret: SECRET,
    recipient: ME,
  });

  /** An `invoke` alone is refused by the pool; it must be paired with a value leg. */
  it("pairs the invoke with a transfer leg", () => {
    expect(actions).toHaveLength(2);
    expect(actions[0]?.type).toBe("transfer");
    expect(actions[1]?.type).toBe("invoke");
  });

  it("opens the note in the token the contract returns", () => {
    expect(actions[0]?.token).toBe(felt(TOKEN));
    expect(actions[0]?.amount).toBe("OPEN");
    expect(actions[0]?.recipient).toBe(felt(ME));
  });

  /**
   * Calldata order IS the signature: the pool deserializes straight into
   * `privacy_invoke(operation, secret, note_id)`. One field out of place reverts with no message.
   */
  it("matches privacy_invoke's parameter order exactly", () => {
    expect(actions[1]?.calldata).toEqual([EXIT.claim, felt(SECRET), OPEN_NOTE_PLACEHOLDER]);
  });

  it("leaves the note placeholder untouched for the wallet to substitute", () => {
    // Interpolating it ourselves would send a literal "${openNoteIds[0]}" as a felt.
    expect(actions[1]?.calldata?.[2]).toBe("${openNoteIds[0]}");
  });

  it("puts no padded felt anywhere in the payload", () => {
    const every = [
      actions[0]?.token,
      actions[0]?.recipient,
      actions[1]?.contract,
      ...(actions[1]?.calldata ?? []),
    ].filter((v): v is string => typeof v === "string" && v.startsWith("0x"));
    for (const v of every) expect(v).not.toMatch(/^0x0[0-9a-f]/);
  });
});

describe("refunding into a shielded note", () => {
  it("differs from a collection only in the operation", () => {
    const args = { claims: CLAIMS, token: TOKEN, secret: SECRET, recipient: ME };
    const claim = buildClaimToNoteActions(args);
    const refund = buildRefundToNoteActions(args);
    expect(refund[1]?.calldata?.[0]).toBe(EXIT.refund);
    expect(claim[1]?.calldata?.[0]).toBe(EXIT.claim);
    // The two operations must be distinct, or one preimage would drive both paths.
    expect(EXIT.claim).not.toBe(EXIT.refund);
    expect(refund[0]).toEqual(claim[0]);
  });
});
