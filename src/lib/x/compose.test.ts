import { describe, expect, it } from "vitest";

import {
  domainOf,
  isVerbatim,
  missionText,
  pickQuote,
  plainWords,
  replyFailedText,
  replyQuestionText,
  replyReadyText,
  resultText,
  ruleBroken,
  usd,
} from "./compose";
import { X_POST_MAX, X_PRICES_MICROS, X_URL_LENGTH, containsUrl, postCostMicros, readCostMicros, xLength } from "./prices";

const LONG_URL = `https://sagepays.xyz/t/${"a".repeat(120)}`;

/** Every amount written in a text, as the digits after a `$`. */
const dollars = (text: string) => [...text.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => m[1]);

describe("how X counts and charges", () => {
  it("counts every link as 23 characters, whatever its length", () => {
    expect(xLength("see https://a.io")).toBe(4 + X_URL_LENGTH);
    expect(xLength(`see ${LONG_URL}`)).toBe(4 + X_URL_LENGTH);
    expect(xLength("try acme.app today")).toBe(4 + X_URL_LENGTH + 6);
  });

  it("counts curly quotes as one and wide characters as two", () => {
    expect(xLength("“ok”")).toBe(4);
    expect(xLength("日本")).toBe(4);
  });

  it("prices a post with a link at the link rate, bare domains included", () => {
    expect(postCostMicros("nothing to click here")).toBe(X_PRICES_MICROS.post);
    expect(postCostMicros("see https://a.io/x")).toBe(X_PRICES_MICROS.postWithUrl);
    expect(postCostMicros("I couldn't open acme.app: it timed out.")).toBe(X_PRICES_MICROS.postWithUrl);
    expect(containsUrl("3 places, $2.50 each. Done.")).toBe(false);
  });

  it("prices a read from what it returned, and an empty one as an owned read", () => {
    expect(readCostMicros({ posts: 2, users: 1 })).toBe(2 * 5_000 + 10_000);
    expect(readCostMicros({ posts: 0, users: 0 })).toBe(X_PRICES_MICROS.ownedRead);
  });

  it("holds the April 2026 rate card", () => {
    expect(X_PRICES_MICROS).toEqual({ post: 15_000, postWithUrl: 200_000, postRead: 5_000, userRead: 10_000, ownedRead: 1_000 });
  });
});

describe("formatting", () => {
  it("writes base units as dollars without rounding", () => {
    expect(usd(2_000_000)).toBe("$2");
    expect(usd(2_500_000)).toBe("$2.50");
    expect(usd(400_000)).toBe("$0.40");
    expect(usd(405_000)).toBe("$0.405");
    expect(usd(BigInt(20_000_000))).toBe("$20");
  });

  it("names a product by its domain", () => {
    expect(domainOf("https://www.Acme.app/pricing?x=1")).toBe("acme.app");
    expect(domainOf("ftp://acme.app")).toBeNull();
    expect(domainOf("not a url")).toBeNull();
  });

  it("refuses free text that carries a handle, a link, an address or an exclamation mark", () => {
    expect(plainWords("  Acme   Notes ", 60)).toBe("Acme Notes");
    expect(plainWords("ask @someone", 60)).toBeNull();
    expect(plainWords("see acme.app", 60)).toBeNull();
    expect(plainWords("pay 0x1234567890abcdef", 60)).toBeNull();
    expect(plainWords("So good!", 60)).toBeNull();
    expect(plainWords("x".repeat(61), 60)).toBeNull();
  });
});

describe("the mission post", () => {
  const facts = { product: "acme.app", places: 10, rewardMinBase: 2_000_000, rewardMaxBase: 2_000_000, onMetis: true, url: "https://sagepays.xyz/t/abc" };

  it("says the product, the ask, the places, the reward and the link", () => {
    expect(missionText(facts)?.text).toBe(
      "New test on Sage: try acme.app and tell us where you get stuck. 10 places, $2 each in USDC on Metis. https://sagepays.xyz/t/abc",
    );
    expect(missionText(facts)?.hasUrl).toBe(true);
  });

  it("carries only the numbers it was given", () => {
    const text = missionText({ ...facts, places: 7, rewardMinBase: 1_500_000, rewardMaxBase: 3_000_000 })?.text ?? "";
    expect(dollars(text)).toEqual(["1.50", "3"]);
    expect(text).toContain("7 places");
    expect(text).toContain("$1.50 to $3 each");
  });

  it("names Metis only when the test pays there", () => {
    expect(missionText({ ...facts, onMetis: false })?.text).not.toContain("Metis");
  });

  it("says one place for one place", () => {
    expect(missionText({ ...facts, places: 1 })?.text).toContain("1 place,");
  });

  it("is not written for a test with no places or no reward", () => {
    expect(missionText({ ...facts, places: 0 })).toBeNull();
    expect(missionText({ ...facts, rewardMinBase: 0 })).toBeNull();
  });

  it("is different for every test", () => {
    const a = missionText(facts)?.text;
    const b = missionText({ ...facts, url: "https://sagepays.xyz/t/abd" })?.text;
    expect(a).not.toBe(b);
  });

  it("stays inside 280 with the longest link and product name it can be handed", () => {
    const text = missionText({ ...facts, product: "a-very-long-product-name-for-a-company.example", places: 100_000, rewardMinBase: 1_234_567, rewardMaxBase: 9_876_543, url: LONG_URL })?.text ?? "";
    expect(text.length).toBeGreaterThan(280);
    expect(xLength(text)).toBeLessThanOrEqual(X_POST_MAX);
  });
});

describe("the result post", () => {
  const facts = { product: "acme.app", people: 8, finding: "Sign-up stalls on the email step", quote: "The code never arrived, so I gave up.", onMetis: true, url: "https://sagepays.xyz/t/abc" };

  it("says how many tried, the finding, one quote, and the link", () => {
    expect(resultText(facts)?.text).toBe(
      "8 people tried acme.app. Sign-up stalls on the email step: “The code never arrived, so I gave up.” Each one checked and paid on Metis. https://sagepays.xyz/t/abc",
    );
  });

  it("uses the quote alone when there is no finding yet", () => {
    expect(resultText({ ...facts, finding: null })?.text).toContain("One said: “The code never arrived, so I gave up.”");
  });

  it("says nothing it wasn't given", () => {
    const text = resultText({ ...facts, finding: null, quote: null })?.text;
    expect(text).toBe("8 people tried acme.app. Each one checked and paid on Metis. https://sagepays.xyz/t/abc");
    expect(dollars(text ?? "")).toEqual([]);
  });

  it("drops a quote whole when it doesn't fit, never shortens it", () => {
    const long = `${"I clicked the button and waited and nothing happened ".repeat(5).trim()}.`;
    const text = resultText({ ...facts, quote: long })?.text ?? "";
    expect(text).not.toContain("“");
    expect(text).toContain("Sign-up stalls on the email step.");
    expect(xLength(text)).toBeLessThanOrEqual(X_POST_MAX);
  });

  it("is not written when nobody was paid", () => {
    expect(resultText({ ...facts, people: 0 })).toBeNull();
  });

  it("says one person for one person", () => {
    expect(resultText({ ...facts, people: 1, finding: null, quote: null })?.text).toBe("1 person tried acme.app. Checked and paid on Metis. https://sagepays.xyz/t/abc");
  });
});

describe("the replies", () => {
  it("says what Sage did and what the drafted test is", () => {
    const text = replyReadyText({ domain: "acme.app", pages: 6, places: 10, totalBase: BigInt(20_000_000), url: "https://sagepays.xyz/t/job1" })?.text;
    expect(text).toBe("I tried acme.app and opened 6 pages. A test is ready: 10 places, $20. https://sagepays.xyz/t/job1");
    expect(dollars(text ?? "")).toEqual(["20"]);
  });

  it("leaves the page count out when there isn't one", () => {
    expect(replyReadyText({ domain: "acme.app", pages: 0, places: 10, totalBase: 20_000_000, url: "https://s.xyz/t/j" })?.text).toBe(
      "I tried acme.app. A test is ready: 10 places, $20. https://s.xyz/t/j",
    );
  });

  it("is not written for a plan with no places or no total", () => {
    expect(replyReadyText({ domain: "acme.app", pages: 6, places: 0, totalBase: 20_000_000, url: "u" })).toBeNull();
    expect(replyReadyText({ domain: "acme.app", pages: 6, places: 10, totalBase: 0, url: "u" })).toBeNull();
  });

  it("asks when Sage needs an answer, and says so plainly when it couldn't open the product", () => {
    expect(replyQuestionText({ domain: "acme.app", url: "https://s.xyz/t/j" })?.text).toBe("I tried acme.app and have a question before a test is ready. https://s.xyz/t/j");
    expect(replyFailedText({ domain: "acme.app", reason: "nothing loaded for me." })?.text).toBe("I couldn't open acme.app: nothing loaded for me.");
  });
});

describe("the writing rules", () => {
  it("refuses a handle, an exclamation mark, an emoji, the retired name and any keys framing", () => {
    expect(ruleBroken("thanks @someone")).toBe("would mention someone");
    expect(ruleBroken("New test on Sage!")).toBe("exclamation mark");
    expect(ruleBroken("New test \u{1F680}")).toBe("emoji");
    expect(ruleBroken("The Deputy paid")).not.toBeNull();
    expect(ruleBroken("a budget, not your keys")).not.toBeNull();
    expect(ruleBroken("x".repeat(281))).toBe("over 280 characters");
    expect(ruleBroken("A plain sentence.")).toBeNull();
  });

  it("refuses a whole text rather than repair it", () => {
    expect(missionText({ product: "Deputy Labs", places: 3, rewardMinBase: 1_000_000, rewardMaxBase: 1_000_000, onMetis: true, url: "https://s.xyz/t/a" })).toBeNull();
    expect(resultText({ product: "acme.app", people: 2, finding: null, quote: "ask @bob about it, he knows more", onMetis: true, url: "https://s.xyz/t/a" })?.text).not.toContain("@");
  });
});

describe("quotes", () => {
  const notes = [
    "ok",
    "Ping @maria for the invite code, she has spares. I got stuck on the pricing page because the button did nothing. Then I left.",
    "Great app!",
  ];

  it("takes one whole sentence, exactly as written", () => {
    const quote = pickQuote(notes);
    expect(quote).toBe("I got stuck on the pricing page because the button did nothing.");
    expect(isVerbatim(quote ?? "", notes)).toBe(true);
  });

  it("passes over sentences with a handle, a link, or too little to say", () => {
    expect(pickQuote(["Ping @maria for the invite code, she has spares."])).toBeNull();
    expect(pickQuote(["Everything is at https://evil.example/claim right now."])).toBeNull();
    expect(pickQuote(["ok", "Fine."])).toBeNull();
  });

  it("knows a paraphrase from a quote", () => {
    expect(isVerbatim("I got stuck on pricing", notes)).toBe(false);
    expect(isVerbatim("", notes)).toBe(false);
  });
});
