import { describe, it, expect } from "vitest";
import { putPendingWithdrawal, consumePendingWithdrawal } from "./pending-withdrawals";

/** Runs against the real in-memory SQLite (vitest sets SAGE_DB_PATH=":memory:"), so the atomic
 *  one-shot consume is proven by the actual engine, not a mock. */

const ADDR = (c: string) => `0x${c.repeat(40).slice(0, 40)}`;

describe("pending withdrawals (durable)", () => {
  it("consumes a prepared withdrawal EXACTLY ONCE", () => {
    const chatId = "chat-consume";
    putPendingWithdrawal({ chatId, amountBase: BigInt(2_500_000), toAddress: ADDR("a") });
    expect(consumePendingWithdrawal(chatId)).toEqual({ toAddress: ADDR("a"), amountBase: BigInt(2_500_000) });
    // a retry (or concurrent confirm) gets null — never a double-send
    expect(consumePendingWithdrawal(chatId)).toBeNull();
  });

  it("rejects an EXPIRED withdrawal", () => {
    const chatId = "chat-expired";
    putPendingWithdrawal({ chatId, amountBase: BigInt(1_000_000), toAddress: ADDR("b"), ttlSeconds: -10 });
    expect(consumePendingWithdrawal(chatId)).toBeNull();
  });

  it("a fresh request REPLACES the previous pending and re-arms consume", () => {
    const chatId = "chat-replace";
    putPendingWithdrawal({ chatId, amountBase: BigInt(1_000_000), toAddress: ADDR("1") });
    putPendingWithdrawal({ chatId, amountBase: BigInt(3_000_000), toAddress: ADDR("2") });
    expect(consumePendingWithdrawal(chatId)).toEqual({ toAddress: ADDR("2"), amountBase: BigInt(3_000_000) });
  });

  it("returns null when nothing is pending", () => {
    expect(consumePendingWithdrawal("chat-none")).toBeNull();
  });
});
