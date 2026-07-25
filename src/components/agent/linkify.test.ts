import { describe, it, expect } from "vitest";
import { trimUrlPunctuation } from "./linkify";

/**
 * REGRESSION — caught while recording a demo. The agent wrote:
 *
 *   "…you can approve and fund the campaign at https://sagepays.xyz/launch/n2Lm_hob4JFU."
 *
 * and the link took the sentence's full stop with it, so the ONE click that matters — the founder
 * going to approve and fund their plan — landed on a 404.
 */

describe("a URL ends where the link ends, not where the sentence does", () => {
  const base = "https://sagepays.xyz/launch/n2Lm_hob4JFU";

  it.each([".", ",", ";", ":", "!", "?", "'", '"', "..", ".)"])(
    "drops trailing %s",
    (tail) => {
      expect(trimUrlPunctuation(base + tail)).toBe(base);
    },
  );

  it("leaves a clean URL untouched", () => {
    expect(trimUrlPunctuation(base)).toBe(base);
    expect(trimUrlPunctuation("https://sagepays.xyz/proof/0xabc")).toBe(
      "https://sagepays.xyz/proof/0xabc",
    );
  });

  it("keeps a path that legitimately ends in punctuation-like characters", () => {
    // a query string and a fragment are part of the link
    expect(trimUrlPunctuation("https://x.dev/a?b=1&c=2")).toBe("https://x.dev/a?b=1&c=2");
    expect(trimUrlPunctuation("https://x.dev/a#section")).toBe("https://x.dev/a#section");
  });

  it("keeps a balanced bracket, drops an unbalanced one", () => {
    expect(trimUrlPunctuation("https://x.dev/a_(b)")).toBe("https://x.dev/a_(b)");
    expect(trimUrlPunctuation("https://x.dev/a)")).toBe("https://x.dev/a");
  });

  it("never eats the whole URL", () => {
    expect(trimUrlPunctuation("https://x.dev/....")).toBe("https://x.dev/");
  });
});
