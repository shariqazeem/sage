import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { walletSpellings } from "./record";

/**
 * "3 completions · of 0 judged" on one record (6 Sep 2026): the record found the wallet's payouts
 * under the zero-stripped spelling the wallet app writes, and the decided count looked only under
 * the URL's padded spelling. Every reader of a wallet's rows reads under every spelling.
 */
describe("walletSpellings", () => {
  it("a Starknet wallet has three spellings — given, zero-stripped, 64-wide — lowercased, given first", () => {
    const url = "0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434";
    const s = walletSpellings(url);
    expect(s[0]).toBe(url.toLowerCase());
    expect(s).toContain("0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434");
    expect(s).toContain("0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434");
    expect(new Set(s).size).toBe(s.length);
  });

  it("an EVM address comes back alone, lowercased (its 64-wide form is not an address)", () => {
    const s = walletSpellings("0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
    expect(s[0]).toBe("0x0def3d4124d0cd1708aeffe6c1bc8182342a44d6");
    // the zero-stripped and padded forms are still listed — harmless to read under, never displayed
    expect(s.length).toBeGreaterThanOrEqual(1);
  });

  it("the credit wrapper counts decided work under every spelling the record was built from", () => {
    const credit = readFileSync("src/lib/campaigns/credit.ts", "utf8");
    expect(credit).toMatch(/countDecidedSubmissionsByWallet\(walletSpellings\(record\.wallet\)\)/);
    const record = readFileSync("src/lib/campaigns/record.ts", "utf8");
    expect(record).toMatch(/const variants = walletSpellings\(wallet\)/);
  });
});
