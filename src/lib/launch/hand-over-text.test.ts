import { describe, expect, it } from "vitest";
import { firstUrl, labelFor, looksLikeProductHome, wordsOnly } from "./hand-over-text";

/** What the founder pasted, read the same way by the box, the server and these tests. */
describe("reading a hand-over", () => {
  it("finds the link in a sentence, without the punctuation after it", () => {
    expect(firstUrl("fix this: https://github.com/acme/app/issues/42.")).toBe("https://github.com/acme/app/issues/42");
    expect(firstUrl("see (https://docs.google.com/document/d/abc/edit), thanks")).toBe("https://docs.google.com/document/d/abc/edit");
    expect(firstUrl("no link here")).toBeNull();
  });

  it("names a link the way a person would", () => {
    expect(labelFor("https://www.github.com/acme/app/issues/42/")).toBe("github.com/acme/app/issues/42");
  });

  it("reads money and headcount only from the words, never from a link", () => {
    expect(wordsOnly("Pay $20 to fix https://github.com/acme/app/issues/42 for 3 people")).toBe("Pay $20 to fix for 3 people");
  });

  it("offers a product test for a site's front page handed over alone, and only then", () => {
    expect(looksLikeProductHome("https://sagepays.xyz")).toBe(true);
    expect(looksLikeProductHome("https://www.acme.com/")).toBe(true);
    expect(looksLikeProductHome("https://acme.com/pricing")).toBe(false);
    expect(looksLikeProductHome("https://github.com/acme")).toBe(false);
    expect(looksLikeProductHome("test https://acme.com")).toBe(false);
    expect(looksLikeProductHome("https://acme.notion.site/")).toBe(false);
  });
});
