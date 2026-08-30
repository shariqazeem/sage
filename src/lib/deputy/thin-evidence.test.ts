import { describe, expect, it } from "vitest";
import { isThinEvidence } from "./evidence";

/**
 * WHEN A PLAIN FETCH IS NOT ENOUGH.
 *
 * The first version was `text.length < 200 || /enable JavaScript/`. That catches the CLASSIC empty
 * shell — `<div id="root"></div>` — and misses the modern one. Starkscan ships a full nav and
 * footer around an empty body, so its 2,753 characters of chrome were never "thin", and the render
 * never fired for the exact page that needed it. Two judgments held on correct evidence as a result.
 *
 * MEASURED, so the thresholds are grounded rather than guessed:
 *
 *   starkscan contract (SPA)   html 115,501  text 1,635  ratio 1.42%  "Checking…"
 *   sagepays landing (SSR)     html  86,009  text 4,165  ratio 4.84%  —
 *   example.com (static)       html     559  text   142  ratio 25.4%  —
 */

const filler = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

describe("what still needs a browser", () => {
  it("near-empty text — the classic shell", () => {
    expect(isThinEvidence("")).toBe(true);
    expect(isThinEvidence(filler(150))).toBe(true);
  });

  it("an explicit no-JS notice, however much chrome surrounds it", () => {
    expect(isThinEvidence(`${filler(3000)} Please enable JavaScript to continue`)).toBe(true);
  });

  it("a shell that says it is still loading — the reported case", () => {
    // The judge literally quoted this: "the page shows 'Checking...'".
    expect(isThinEvidence(`Home Contracts Checking… ${filler(2700)}`)).toBe(true);
    expect(isThinEvidence(`${filler(2700)} Loading...`)).toBe(true);
    expect(isThinEvidence(`${filler(2700)} please wait…`)).toBe(true);
  });

  it("a big payload whose visible text is a rounding error", () => {
    // starkscan's real shape: 1.42% of 115KB.
    expect(isThinEvidence(filler(1635), filler(115_501))).toBe(true);
  });

  it("does NOT fire on a server-rendered page with plenty of text", () => {
    // sagepays' own landing: 4.84% of 86KB. Rendering every page like this would cost a browser
    // launch per submission for nothing.
    expect(isThinEvidence(filler(4165), filler(86_009))).toBe(false);
  });

  it("still fires on a genuinely tiny page, by LENGTH not by ratio", () => {
    // example.com: 142 characters of text. That is thin on its own terms, and was already caught
    // before any of this — the ratio rule is not what decides it.
    expect(isThinEvidence(filler(142), filler(559))).toBe(true);
    expect(isThinEvidence(filler(142))).toBe(true);
  });

  it("ignores the ratio on a payload too small to mean anything", () => {
    // 1% of 3KB is 30 characters — already caught by the length rule, and applying a ratio to a
    // tiny document would make every short page look like a shell.
    expect(isThinEvidence(filler(400), filler(3_000))).toBe(false);
  });

  it("still decides without the raw html", () => {
    expect(isThinEvidence(filler(3000))).toBe(false);
    expect(isThinEvidence(filler(50))).toBe(true);
  });
});
