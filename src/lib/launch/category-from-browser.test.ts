import { describe, expect, it } from "vitest";
import { inferCategory } from "./product-map";
import type { FieldTestSummary } from "./schemas";

/**
 * A BOT-WALLED PRODUCT WAS UNCATEGORIZABLE BY CONSTRUCTION.
 *
 * inferCategory read only the STATIC crawl, so when a WAF returns nothing to Sage's read-only UA
 * the blob is empty and every hint misses. MEASURED by P-GEN: cnn.com and web.telegram.org both
 * came back "product (uncategorized)" while the real browser had already read their pages — the
 * evidence existed, the categorizer wasn't looking at it. The category frames the whole product for
 * the mission brain, so getting it wrong is not cosmetic.
 */
const ft = (over: Partial<FieldTestSummary>): FieldTestSummary =>
  ({ ran: true, startUrl: "https://walled.test/", mode: "static", pages: [], states: [], classification: null, limitation: null, durationMs: 1, ...over }) as FieldTestSummary;

describe("category survives a bot wall", () => {
  it("categorises from the BROWSER's pages when the static crawl saw nothing", () => {
    const category = inferCategory([], ft({
      pages: [{ url: "https://walled.test/", title: "Breaking News, Latest News and Videos", h1: "Top stories", ctas: [], consoleErrors: [], brokenRequests: [], jsOnly: false, visibleTextExcerpt: "world politics" } as never],
    }));
    expect(category).toBe("content / media");
  });

  it("categorises from on-screen STATE text a wall only reveals after interaction", () => {
    const category = inferCategory([], ft({
      mode: "interactive",
      states: [{ trigger: "initial load", visibleTextExcerpt: "Connect your crypto wallet to continue", notableElements: [], screenshot: null, pixelDeltaPct: 0, url: "https://walled.test/", networkMethods: [] } as never],
    }));
    expect(category).toBe("web3 / crypto");
  });

  /** The vision model's READING of on-screen text is evidence; its narration is not. A structural
   *  field must not be steered by model prose. */
  it("uses vision's visibleText but NOT its sceneDescription", () => {
    const fromText = inferCategory([], ft({
      mode: "interactive",
      visionObservations: [{ visibleText: ["Pricing", "Add to cart"], sceneDescription: "", uiElements: [], productTypeSignals: [], audienceSignals: [] } as never],
    }));
    expect(fromText).toBe("commerce / saas");

    const fromProse = inferCategory([], ft({
      mode: "interactive",
      visionObservations: [{ visibleText: [], sceneDescription: "This looks like an online store with a shopping cart", uiElements: [], productTypeSignals: [], audienceSignals: [] } as never],
    }));
    expect(fromProse).toBe("product (uncategorized)");
  });

  it("still returns uncategorized when nothing at all was observed", () => {
    expect(inferCategory([], ft({}))).toBe("product (uncategorized)");
  });
});
