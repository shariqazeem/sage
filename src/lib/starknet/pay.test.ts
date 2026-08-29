import { describe, expect, it } from "vitest";

import { MAX_DIRECT_BATCH, validateDirectBatch, type DirectPayment } from "./pay";

const pay = (over: Partial<DirectPayment> = {}): DirectPayment => ({
  recipient: "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048",
  amountBase: BigInt(500_000),
  ...over,
});

describe("direct payment rules", () => {
  it("totals a batch exactly, in base units", () => {
    const total = validateDirectBatch([
      pay({ amountBase: BigInt(1_400_000) }),
      pay({ recipient: "0x02", amountBase: BigInt(650_000) }),
      pay({ recipient: "0x03", amountBase: BigInt(1_115_000) }),
    ]);
    // Integer arithmetic end to end — no float ever touches an amount.
    expect(total).toBe(BigInt(3_165_000));
  });

  it("refuses an empty batch", () => {
    expect(() => validateDirectBatch([])).toThrow(/nothing to pay/);
  });

  it("refuses a zero or negative payment", () => {
    expect(() => validateDirectBatch([pay({ amountBase: BigInt(0) })])).toThrow(/positive amount/);
    expect(() => validateDirectBatch([pay({ amountBase: BigInt(-1) })])).toThrow(/positive amount/);
  });

  /**
   * A malformed address is money sent somewhere real and unrecoverable, or a revert after the fee.
   * Either way it must never reach a signer.
   */
  it("refuses anything that is not a Starknet address", () => {
    for (const bad of ["", "0x", "not-an-address", "0xzz", "my-paypal"]) {
      expect(() => validateDirectBatch([pay({ recipient: bad })])).toThrow(/not a Starknet address/);
    }
  });

  it("accepts the documented batch ceiling and refuses one past it", () => {
    const at = Array.from({ length: MAX_DIRECT_BATCH }, (_, i) => pay({ recipient: `0x${i + 1}` }));
    expect(() => validateDirectBatch(at)).not.toThrow();
    expect(() => validateDirectBatch([...at, pay({ recipient: "0xffff" })])).toThrow(/exceeds/);
  });

  /**
   * One person can legitimately be paid for two missions in the same run. Silently collapsing that
   * would drop money someone earned — deduplication belongs upstream, where "two payouts" can be
   * told apart from "the same payout twice".
   */
  it("allows the same recipient twice rather than guessing it is a duplicate", () => {
    const total = validateDirectBatch([
      pay({ amountBase: BigInt(500_000) }),
      pay({ amountBase: BigInt(250_000) }),
    ]);
    expect(total).toBe(BigInt(750_000));
  });

  it("does not lose precision on a large batch", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      pay({ recipient: `0x${i + 1}`, amountBase: BigInt(333_333) }),
    );
    expect(validateDirectBatch(many)).toBe(BigInt(333_333) * BigInt(50));
  });
});
