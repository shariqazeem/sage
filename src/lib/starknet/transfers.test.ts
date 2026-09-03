import { describe, expect, it } from "vitest";
import { accountNonce, padFelt, transfersFrom, transfersTo, TRANSFER_SELECTOR, type Rpc } from "./transfers";

const W = "0x0499b03b05e4409e1a48de30aac576381d6f650ad6c36fec664301bec8da11d5";
const HUB = "0x0270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de";

describe("Starknet transfer reader", () => {
  it("pads a felt to 64 hex digits, so the two spellings of one address compare equal", () => {
    expect(padFelt("0x1d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e42fec94e7367c")).toBe("0x01d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e42fec94e7367c");
  });

  it("reads keyed (Cairo 1) and data-only (legacy) Transfer events, following continuation tokens", async () => {
    const calls: unknown[] = [];
    const rpc: Rpc = async (method, params) => {
      calls.push([method, params]);
      const p = (params as [{ continuation_token?: string; keys: string[][] }])[0];
      if (!p.continuation_token)
        return { events: [{ keys: [TRANSFER_SELECTOR, HUB, W], data: ["0x1e8480", "0x0"], block_number: 14276794, transaction_hash: "0xaa" }], continuation_token: "next" };
      return { events: [{ keys: [TRANSFER_SELECTOR], data: [HUB, W, "0x10c8e0", "0x0"], block_number: 14276800, transaction_hash: "0xbb" }] };
    };
    const t = await transfersTo(rpc, "0xtoken", W, 100);
    expect(t.map((x) => [x.from, x.to, Number(x.value), x.block])).toEqual([[HUB, W, 2_000_000, 14276794], [HUB, W, 1_100_000, 14276800]]);
    // the `to` filter sits in the third key position; `from` in the second
    expect((calls[0] as [string, [{ keys: string[][] }]])[1][0].keys).toEqual([[TRANSFER_SELECTOR], [], [W]]);
    await transfersFrom(rpc, "0xtoken", W, 100);
    expect((calls[2] as [string, [{ keys: string[][] }]])[1][0].keys).toEqual([[TRANSFER_SELECTOR], [W]]);
  });

  it("an undeployed account reads as nonce 0 rather than an error", async () => {
    const rpc: Rpc = async () => { throw new Error("Contract not found"); };
    expect(await accountNonce(rpc, W)).toBe(0);
    const ok: Rpc = async () => "0x3";
    expect(await accountNonce(ok, W)).toBe(3);
  });
});
