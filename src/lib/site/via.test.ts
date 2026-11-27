import { describe, expect, it } from "vitest";
import { cleanVia, nextStored, readStored, VIA_TTL_MS } from "./via";

/** Where a builder came from: a short word, first touch, 30 days. */
const NOW = 1_800_000_000_000;
const kept = (tag: string, at = NOW) => JSON.stringify({ tag, at });

describe("a tag", () => {
  it("is a short lower-case word, and anything else is nothing", () => {
    expect(cleanVia("tiktok")).toBe("tiktok");
    expect(cleanVia(" TikTok ")).toBe("tiktok");
    expect(cleanVia("dm-nov-28")).toBe("dm-nov-28");
    for (const bad of ["", "a b", "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3", "me@example.com", "<script>", "a".repeat(33), "tik_tok", null, undefined, 7, {}]) {
      expect(cleanVia(bad), String(bad)).toBeNull();
    }
  });
});

describe("what the browser keeps", () => {
  it("keeps the first tag and ignores a later one while it is fresh", () => {
    const first = nextStored("?via=tiktok", null, NOW);
    expect(first).toBe(kept("tiktok"));
    expect(nextStored("?via=dm", first, NOW + 1000)).toBeNull();
    expect(readStored(first, NOW + 1000)).toBe("tiktok");
  });

  it("writes nothing for a page with no tag or a bad one", () => {
    expect(nextStored("", null, NOW)).toBeNull();
    expect(nextStored("?test=https://a.example", null, NOW)).toBeNull();
    expect(nextStored("?via=not%20a%20tag", null, NOW)).toBeNull();
  });

  it("forgets after 30 days, and then takes the next tag", () => {
    const old = kept("tiktok", NOW - VIA_TTL_MS - 1);
    expect(readStored(old, NOW)).toBeNull();
    expect(nextStored("?via=dm", old, NOW)).toBe(kept("dm"));
    expect(readStored(kept("tiktok", NOW - VIA_TTL_MS), NOW)).toBe("tiktok");
  });

  it("reads nothing from storage it did not write", () => {
    for (const junk of ["tiktok", "{", "null", JSON.stringify({ tag: "A B", at: NOW }), JSON.stringify({ tag: "ok" }), JSON.stringify({ tag: "ok", at: NOW + 10 * 24 * 3600 * 1000 })]) {
      expect(readStored(junk, NOW), junk).toBeNull();
    }
  });
});
