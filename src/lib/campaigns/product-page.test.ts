import { describe, expect, it } from "vitest";
import { isProductPage, isTesterMadeContract, sameOrigin, urlOrigin } from "./product-page";

/**
 * A PAGE ON THE PRODUCT IS NOT A PROOF THE TESTER MADE. The replay index and the judge's capture
 * choice both read this one answer; the cases are the ones measured on prod (plausible.io, 2026-09-11)
 * plus the shapes that must NOT be relaxed.
 */
const PRODUCT = "https://plausible.io/";

describe("origins", () => {
  it("compares scheme + host + port, case-insensitively on the host", () => {
    expect(urlOrigin("https://Plausible.IO/plausible.io?period=7d")).toBe("https://plausible.io");
    expect(sameOrigin("https://plausible.io/plausible.io", PRODUCT)).toBe(true);
    expect(sameOrigin("http://plausible.io/", PRODUCT)).toBe(false);
    expect(sameOrigin("https://plausible.io:8443/", PRODUCT)).toBe(false);
  });

  it("never matches an unparseable side", () => {
    expect(urlOrigin("not a url")).toBeNull();
    expect(sameOrigin("not a url", "not a url")).toBe(false);
    expect(sameOrigin(null, PRODUCT)).toBe(false);
    expect(sameOrigin(PRODUCT, undefined)).toBe(false);
  });
});

describe("which links are pages on the product", () => {
  it("the live demo the mission walked the tester to, on an inspection mission with no contract", () => {
    expect(isProductPage("https://plausible.io/plausible.io", { productUrl: PRODUCT, contractKind: null })).toBe(true);
  });

  it("a deliverable the contract says the tester made, even on the product's own origin", () => {
    // A UGC product: "publish a post here and link it". The link is the tester's alone.
    expect(isProductPage("https://plausible.io/u/alice/post-1", { productUrl: PRODUCT, contractKind: "artifact_url" })).toBe(false);
    expect(isProductPage("https://plausible.io/u/alice/post-1", { productUrl: PRODUCT, contractKind: "public_url" })).toBe(false);
    expect(isTesterMadeContract("artifact_url")).toBe(true);
    expect(isTesterMadeContract("public_url")).toBe(true);
    expect(isTesterMadeContract("onchain_tx")).toBe(false);
    expect(isTesterMadeContract(null)).toBe(false);
  });

  it("an artifact on another host is never a page on the product", () => {
    expect(isProductPage("https://gist.github.com/alice/abc", { productUrl: PRODUCT, contractKind: null })).toBe(false);
  });

  it("with no inspected product there is nothing to be on — every link is the tester's own", () => {
    expect(isProductPage("https://plausible.io/plausible.io", { productUrl: null, contractKind: null })).toBe(false);
    expect(isProductPage("", { productUrl: PRODUCT, contractKind: null })).toBe(false);
  });
});
