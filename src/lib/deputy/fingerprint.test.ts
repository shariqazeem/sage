import { describe, expect, it } from "vitest";
import { artifactFingerprint, fingerprintSimilarity, stripMarkers, MINHASH_SLOTS } from "./fingerprint";
import { NEAR_DUP_THRESHOLD } from "./dedup";

/**
 * The copied-artifact vector: an honest deliverable page, copied by a second wallet with the marker
 * swapped, must read as a near-duplicate ABOVE the calibrated threshold; two genuinely different
 * write-ups of the same brief must read far below it. Same bar as report paraphrase detection.
 */
const WALLET_A = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const WALLET_B = "0x9a8B7c6D5e4F3a2B1c0D9e8F7a6B5c4D3e2F1a0B";
const honest = `Sage walkthrough by ${WALLET_A}. I connected my wallet, opened the campaign board, picked the
pricing-page mission and followed the three steps. The pricing page lists Starter, Growth and Scale; the
Growth plan shows a 14-day trial and the checkout asks for a card before the trial starts, which surprised
me. The receipt link resolved on the explorer within a minute. Overall the flow is clear but the trial
copy is misleading and the footer link to the refund policy is broken on mobile. Verified for ${WALLET_A}.`;
const copied = honest.split(WALLET_A).join(WALLET_B).replace("surprised me", "surprised me a little");
const different = `Walkthrough for ${WALLET_B}. Started from the docs quickstart instead of the board. The install
command failed on Node 18 until I upgraded; after that the dashboard rendered but the chart was empty for the
first minute. I filed the empty-state as the main issue: a new founder sees a blank graph and no hint that data
takes time. Pricing looked fine to me. The mobile menu overlaps the wallet button. Signed by ${WALLET_B}.`;

describe("artifact fingerprint — copied work reads as a duplicate, different work does not", () => {
  it("is deterministic and marker-agnostic", () => {
    const a = artifactFingerprint(honest, [WALLET_A]);
    expect(a).not.toBeNull();
    expect(a!.split(".").length).toBe(MINHASH_SLOTS);
    expect(artifactFingerprint(honest, [WALLET_A])).toBe(a);
    // the same body with only the marker changed fingerprints identically once markers are stripped
    expect(artifactFingerprint(honest.split(WALLET_A).join(WALLET_B), [WALLET_B])).toBe(a);
  });

  it("a marker-swapped copy with a light edit sits ABOVE the near-dup threshold; a different write-up sits far below", () => {
    const a = artifactFingerprint(honest, [WALLET_A])!;
    const c = artifactFingerprint(copied, [WALLET_B])!;
    const d = artifactFingerprint(different, [WALLET_B])!;
    expect(fingerprintSimilarity(a, c)).toBeGreaterThanOrEqual(NEAR_DUP_THRESHOLD);
    expect(fingerprintSimilarity(a, d)).toBeLessThan(0.2);
    expect(fingerprintSimilarity(a, a)).toBe(1);
  });

  it("refuses to fingerprint a body too short to be meaningful, and ignores malformed signatures", () => {
    expect(artifactFingerprint("Verified for " + WALLET_A, [WALLET_A])).toBeNull();
    expect(fingerprintSimilarity("abc", "abc")).toBe(0);
    expect(fingerprintSimilarity(null, "x")).toBe(0);
  });

  it("stripMarkers never strips short common tokens", () => {
    expect(stripMarkers("the cat sat", ["the", "cat"])).toBe("the cat sat");
    expect(stripMarkers(`hello ${WALLET_A} world`, [WALLET_A]).replace(/\s+/g, " ").trim()).toBe("hello world");
  });
});
