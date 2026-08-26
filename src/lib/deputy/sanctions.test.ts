import { describe, expect, it } from "vitest";

import { isSanctionedWallet, SANCTIONS_HOLD_REASON, SANCTIONS_LIST_LABEL, SANCTIONS_LIST_SIZE, OFAC_SDN_SNAPSHOT_DATE } from "./sanctions";
import { OFAC_SDN_ETH } from "./sanctions-data";

/**
 * SANCTIONS SCREEN (FC plan #2) — exact-match, case-insensitive, fail-safe on junk. The vendored
 * snapshot itself is pinned for shape (a refresh that emptied or corrupted the list must fail loud
 * here, not silently stop screening).
 */

describe("isSanctionedWallet", () => {
  it("matches a listed address in any casing; never matches clean or malformed input", () => {
    const listed = OFAC_SDN_ETH[0]!;
    expect(isSanctionedWallet(listed)).toBe(true);
    expect(isSanctionedWallet(listed.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isSanctionedWallet(` ${listed} `)).toBe(true);

    // the Ronin/Lazarus 2022 exploiter — a durable, well-known SDN entry
    expect(isSanctionedWallet("0x098B716B8Aaf21512996dC57EB0615e2383E2f96")).toBe(true);

    expect(isSanctionedWallet(`0x${"9".repeat(40)}`)).toBe(false);
    expect(isSanctionedWallet("not-a-wallet")).toBe(false);
    expect(isSanctionedWallet("")).toBe(false);
    expect(isSanctionedWallet(null)).toBe(false);
    expect(isSanctionedWallet(undefined)).toBe(false);
  });

  it("snapshot is plausible and provenance-stamped", () => {
    expect(SANCTIONS_LIST_SIZE).toBeGreaterThan(50);
    expect(OFAC_SDN_ETH.every((a) => /^0x[0-9a-f]{40}$/.test(a))).toBe(true); // generator lowercases
    expect(OFAC_SDN_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SANCTIONS_HOLD_REASON).toBe(`sanctions_screen:ofac_sdn:${OFAC_SDN_SNAPSHOT_DATE}`);
    expect(SANCTIONS_LIST_LABEL).toContain(OFAC_SDN_SNAPSHOT_DATE);
  });
});
