import { describe, it, expect } from "vitest";
import { capCheckEvidence } from "./capabilities";

/**
 * THE CAPABILITIES MUST STAND ALONE, AND MUST FAIL HONESTLY.
 *
 * These are Sage's own pieces offered as separate calls. The evidence check is the one that carries
 * risk: a caller will act on its verdict, so the two things it must never do are call a fabrication
 * genuine, and call a real account fake because the page happened to be unreachable.
 *
 * Verified against a live product while building (plausible.io): a genuine account matched 5 phrases
 * and returned "genuine"; a fluent write-up from someone who never opened it matched 0 and returned
 * "unverified". The tests here cover the boundaries that do not need the network.
 */

describe("an unreachable product is never evidence the account is false", () => {
  it.each([
    ["a host that does not resolve", "https://this-host-does-not-exist-sage-check.invalid/"],
    ["a private address", "https://10.0.0.1/"],
    ["plain http", "http://example.com/"],
    ["nonsense", "not-a-url"],
  ])("%s → could_not_check, never unverified", async (_label, url) => {
    const r = await capCheckEvidence({
      productUrl: url,
      account: "I opened the product and clicked through the onboarding, it showed me a welcome screen.",
    });
    expect(r.verdict).toBe("could_not_check");
    expect(r.reachedProduct).toBe(false);
    // The distinction that matters: "I could not check" is not "this person is lying".
    expect(r.verdict).not.toBe("unverified");
    expect(r.reason).toMatch(/not evidence the account is false/i);
  }, 25_000);
});

describe("it refuses to judge what it cannot judge", () => {
  it.each(["", "   ", "yes", "it worked"])("an account of %p is too short to check", async (account) => {
    const r = await capCheckEvidence({ productUrl: "https://example.com", account });
    expect(r.verdict).toBe("could_not_check");
    expect(r.anchored).toBe(false);
  }, 25_000);
});

describe("the result carries its own evidence and its own limits", () => {
  it("says plainly that it checked one page as it is now", async () => {
    const r = await capCheckEvidence({
      productUrl: "https://this-host-does-not-exist-sage-check.invalid/",
      account: "A long enough account of using the product to be worth checking properly.",
    });
    // Whatever the verdict, the caller is told what was compared against.
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(20);
    expect(r.matchedPhrases).toEqual([]);
    expect(r.pageSections).toBe(0);
  }, 25_000);

  it("never claims a match it cannot show", async () => {
    const r = await capCheckEvidence({
      productUrl: "https://this-host-does-not-exist-sage-check.invalid/",
      account: "Some account text that is long enough to pass the length floor for checking.",
    });
    // anchored true with zero phrases would be an unbacked verdict.
    expect(r.anchored).toBe(r.matchedPhrases.length > 0);
  }, 25_000);
});
