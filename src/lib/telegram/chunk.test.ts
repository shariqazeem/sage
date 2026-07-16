import { describe, it, expect } from "vitest";
import { splitForTelegram, TELEGRAM_MAX } from "./chunk";

const strip = (s: string) => s.replace(/\s/g, "");

describe("splitForTelegram", () => {
  it("returns a short message (<= limit) as a single unchanged chunk", () => {
    expect(splitForTelegram("hello world")).toEqual(["hello world"]);
    const exact = "x".repeat(TELEGRAM_MAX);
    expect(splitForTelegram(exact)).toEqual([exact]);
  });

  it("keeps every chunk within the limit and loses no content", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i}: ` + "lorem ipsum ".repeat(30)).join("\n\n");
    expect(text.length).toBeGreaterThan(4096);
    const chunks = splitForTelegram(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    expect(chunks.map(strip).join("")).toBe(strip(text)); // no character dropped or duplicated
  });

  it("respects the real 4096 boundary", () => {
    const text = ("A very long sentence that keeps going and going. ").repeat(200);
    const chunks = splitForTelegram(text); // default TELEGRAM_MAX
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096);
  });

  it("NEVER splits a URL across chunks", () => {
    const url = "https://sagepays.xyz/proof/0x" + "a".repeat(64);
    const text = "word ".repeat(120) + url + " and some trailing words here";
    const chunks = splitForTelegram(text, 200);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    // the full URL appears intact in exactly one chunk...
    expect(chunks.filter((c) => c.includes(url))).toHaveLength(1);
    // ...and no other chunk holds a fragment of it.
    for (const c of chunks) if (!c.includes(url)) expect(c.includes("https://sagepays.xyz/proof")).toBe(false);
  });

  it("keeps a lone oversized URL whole rather than slicing it", () => {
    const hugeUrl = "https://x.example/" + "p".repeat(300);
    const chunks = splitForTelegram(`see ${hugeUrl} now`, 100);
    expect(chunks.some((c) => c.includes(hugeUrl))).toBe(true);
  });

  it("prefers paragraph boundaries over cutting mid-paragraph", () => {
    const p1 = "A".repeat(300);
    const p2 = "B".repeat(300);
    expect(splitForTelegram(`${p1}\n\n${p2}`, 400)).toEqual([p1, p2]);
  });

  it("breaks a single oversized paragraph by lines then words", () => {
    const para = Array.from({ length: 20 }, (_, i) => `line ${i} ` + "w ".repeat(20)).join("\n");
    const chunks = splitForTelegram(para, 120);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    expect(chunks.map(strip).join("")).toBe(strip(para));
  });
});
