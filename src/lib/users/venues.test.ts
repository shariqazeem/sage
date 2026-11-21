import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY, VENUES, venuesFor } from "./venues";

/**
 * Two lists that must not drift: the categories an inspection can name (`CATEGORY_HINTS` and the
 * fallback in product-map.ts) and the categories this table answers. Read from the source, so a new
 * category without venues fails here.
 */
const source = readFileSync(path.join(process.cwd(), "src/lib/launch/product-map.ts"), "utf8");
const hints = source.slice(source.indexOf("const CATEGORY_HINTS"), source.indexOf("export function inferCategory"));
const named = [...hints.matchAll(/\/[a-z]*,\s*"([^"]+)"\s*\]/g)].map((m) => m[1]!);

describe("where your users are", () => {
  it("answers every category the inspection can name, and only those", () => {
    expect(named.length).toBeGreaterThanOrEqual(7);
    expect(source).toContain(`return "${DEFAULT_CATEGORY}"`);
    expect(Object.keys(VENUES).sort()).toEqual([...new Set([...named, DEFAULT_CATEGORY])].sort());
  });

  it("gives each category three to five venues, each with an https link and a one-line rule", () => {
    for (const [category, list] of Object.entries(VENUES)) {
      expect(list.length, category).toBeGreaterThanOrEqual(3);
      expect(list.length, category).toBeLessThanOrEqual(5);
      expect(new Set(list.map((v) => v.name)).size, category).toBe(list.length);
      for (const v of list) {
        expect(v.url).toMatch(/^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9/._-]*)?$/);
        expect(v.rule.length).toBeGreaterThan(20);
        expect(v.rule.length).toBeLessThanOrEqual(170);
        expect(v.rule).not.toMatch(/\n|\p{Extended_Pictographic}/u);
      }
    }
  });

  it("never sends reading material to Show HN", () => {
    expect(venuesFor("content / media").some((v) => /show hn/i.test(v.name))).toBe(false);
  });

  it("falls back to the general list for a category it has never seen", () => {
    expect(venuesFor("something new")).toBe(VENUES[DEFAULT_CATEGORY]);
    expect(venuesFor(null)).toBe(VENUES[DEFAULT_CATEGORY]);
  });
});
