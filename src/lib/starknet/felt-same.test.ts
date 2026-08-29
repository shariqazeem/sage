import { describe, expect, it } from "vitest";
import { sameFelt } from "./felt";

/**
 * A wallet may return `0x05db…` where a session stored `0x5db…`. They are one account. Comparing
 * them as strings would tell a founder their own wallet is not the one they signed in with, and
 * block a deployment that was perfectly correct.
 */
describe("sameFelt", () => {
  const A = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
  const BARE = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

  it("matches across padding and casing", () => {
    expect(sameFelt(A, BARE)).toBe(true);
    expect(sameFelt(A.toUpperCase().replace("0X", "0x"), BARE)).toBe(true);
    expect(sameFelt(`0x000${BARE.slice(2)}`, A)).toBe(true);
  });

  it("does not match two different accounts", () => {
    expect(sameFelt(A, BARE.replace(/8$/, "9"))).toBe(false);
  });

  it("never says two absent values are the same account", () => {
    // Otherwise a missing session address would "match" a missing wallet address and wave the
    // owner check through.
    expect(sameFelt(null, null)).toBe(false);
    expect(sameFelt(undefined, undefined)).toBe(false);
    expect(sameFelt("", "")).toBe(false);
    expect(sameFelt("0x0", "0x0")).toBe(false);
  });

  it("refuses non-hex rather than comparing loosely", () => {
    expect(sameFelt("nonsense", "nonsense")).toBe(false);
  });
});
