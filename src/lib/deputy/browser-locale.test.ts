import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * EVERY BROWSER SAGE OPENS HAS A LOCALE. Two headless contexts drifted: the field test (the
 * inspection's eyes) was written with `locale: "en-US"`; the evidence renderer (the judge's eyes)
 * was not. On the production box a context with no locale reports `navigator.language` as
 * "en-US@posix", and plausible.io's dashboard declined to mount under it — silently: no console
 * error, no failed request, an empty stats container for 25 seconds. The judge then held a genuine
 * report for "the page shows no visitor numbers" while the same page rendered fully on a laptop.
 *
 * This reads both sources, so the next context someone adds without a locale fails here instead
 * of in a tester's payout.
 */
const CONTEXTS = ["src/lib/launch/field-test.ts", "src/lib/deputy/evidence-render.ts"];

describe("every headless browser context carries a real locale", () => {
  for (const f of CONTEXTS) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      const calls = [...src.matchAll(/newContext\(\{/g)];
      expect(calls.length, "opens at least one context").toBeGreaterThan(0);
      for (const m of calls) {
        const body = src.slice(m.index, m.index + 3000);
        expect(body, `context at offset ${m.index} sets locale`).toMatch(/locale:\s*"en-US"/);
      }
    });
  }
  it("the renderer also pins the timezone, so a capture does not depend on where the box is", () => {
    expect(readFileSync("src/lib/deputy/evidence-render.ts", "utf8")).toMatch(/timezoneId:\s*"UTC"/);
  });
});
