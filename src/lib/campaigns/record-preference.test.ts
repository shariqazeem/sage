import { describe, expect, it } from "vitest";

import { isRecordPrivate, setRecordPrivate } from "./record-preference";

const W = "0x00000000000000000000000000000000000000c1";

describe("record privacy is a worker's choice, defaulting to public", () => {
  /**
   * THE DEFAULT IS THE POINT. Public receipts are what the record is FOR when the money is grant
   * or MSME capital — a programme distributing funds has to show where they went. A ledger that
   * hid amounts by default would be useless to the institutions this exists to serve.
   */
  it("is public for a wallet that has never chosen", () => {
    expect(isRecordPrivate("0x00000000000000000000000000000000000000ff")).toBe(false);
  });

  it("becomes private only when the worker asks", () => {
    expect(isRecordPrivate(W)).toBe(false);
    setRecordPrivate(W, true);
    expect(isRecordPrivate(W)).toBe(true);
  });

  it("can be turned back on — the choice is not one-way", () => {
    setRecordPrivate(W, true);
    setRecordPrivate(W, false);
    expect(isRecordPrivate(W)).toBe(false);
  });

  it("is case-insensitive, so a checksummed address is the same worker", () => {
    setRecordPrivate(W.toUpperCase().replace("0X", "0x"), true);
    expect(isRecordPrivate(W)).toBe(true);
    expect(isRecordPrivate(W.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("does not leak one wallet's choice onto another", () => {
    setRecordPrivate(W, true);
    expect(isRecordPrivate("0x00000000000000000000000000000000000000c2")).toBe(false);
  });

  it("treats an empty wallet as public rather than throwing", () => {
    expect(isRecordPrivate("")).toBe(false);
    expect(() => setRecordPrivate("", true)).toThrow(/wallet is required/);
  });
});
