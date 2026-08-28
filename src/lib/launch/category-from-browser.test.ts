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

/**
 * A LOGIN WALL IS ITSELF AN OBSERVATION.
 *
 * MEASURED on web.telegram.org: the only text Sage can see is "Log in to Telegram by QR Code /
 * Open Telegram on your phone", which names no category — not even messaging. Guessing "messaging"
 * from the brand would be knowledge Sage does not have; "uncategorized" throws away the one thing
 * it does know. The category frames the product for the mission brain, and "this is behind a wall"
 * is a genuinely useful frame.
 */
describe("categories that were simply missing", () => {
  const page = (title: string, h1: string, text: string) =>
    ft({ pages: [{ url: "https://x.test/", title, h1, ctas: [], consoleErrors: [], brokenRequests: [], jsOnly: false, visibleTextExcerpt: text } as never] });

  it("names a login wall instead of giving up", () => {
    expect(inferCategory([], page("Telegram", "Log in to Telegram by QR Code", "Open Telegram on your phone. Go to Settings > Devices > Add Device."))).toBe("login-walled product");
  });

  it("recognises a messaging product when its text says so", () => {
    expect(inferCategory([], page("Chatly", "Your inbox", "Send messages and start conversations with your team"))).toBe("messaging / social");
  });

  /** The wall is LAST, so a product that identifies itself is never mislabelled by a nav link. */
  it("does not mistake a shop with a Log in link for a wall", () => {
    expect(inferCategory([], page("Store", "Shop our range", "Log in. Add to cart. Checkout securely."))).toBe("commerce / saas");
  });
});
