import { describe, expect, it } from "vitest";
import { buildFunnel, buildSources, funnelLine, looksLikeBot, sourceOf, type FunnelInput, type FunnelVisit } from "./funnel";

/**
 * WHO CAME AND HOW FAR THEY GOT (funnel.ts). The counts are people, every stage means "at least this far",
 * and a source is a visitor's first touch.
 */
const W = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
const visit = (over: Partial<FunnelVisit> & { visitor: string }): FunnelVisit => ({ wallet: null, source: "direct", firstAt: 100, signedInAt: null, openedAt: null, ...over });
const counts = (input: FunnelInput) => buildFunnel(input).stages.map((s) => s.people);

describe("where a first visit came from", () => {
  it("reads the word Sage's own links carry, and only a known one", () => {
    expect(sourceOf({ via: "x" })).toBe("x");
    expect(sourceOf({ via: "tg" })).toBe("telegram");
    expect(sourceOf({ via: "Telegram" })).toBe("telegram");
    expect(sourceOf({ via: "earn" })).toBe("earn");
    expect(sourceOf({ via: "alert" })).toBe("alert");
    expect(sourceOf({ via: "link" })).toBe("link");
    expect(sourceOf({ via: "home" })).toBe("sage");
    expect(sourceOf({ via: "sage" })).toBe("sage");
    // a link cannot invent a source: an unknown word falls through to the referrer
    expect(sourceOf({ via: "partner-newsletter" })).toBe("direct");
    expect(sourceOf({ via: "nonsense", ref: "https://t.co/abc" })).toBe("x");
  });

  it("falls back to the referring page's host", () => {
    expect(sourceOf({ ref: "https://t.co/abc" })).toBe("x");
    expect(sourceOf({ ref: "https://x.com/sagepaysai/status/1" })).toBe("x");
    expect(sourceOf({ ref: "https://mobile.twitter.com/a" })).toBe("x");
    expect(sourceOf({ ref: "https://t.me/sagetests/4" })).toBe("telegram");
    expect(sourceOf({ ref: "https://web.telegram.org/k/" })).toBe("telegram");
    expect(sourceOf({ ref: "https://sagepays.xyz/earn" })).toBe("earn");
    expect(sourceOf({ ref: "https://www.sagepays.xyz/earn/" })).toBe("earn");
    expect(sourceOf({ ref: "https://sagepays.xyz/" })).toBe("sage");
    expect(sourceOf({ ref: "https://sagepays.xyz/earnest" })).toBe("sage");
    expect(sourceOf({ ref: "" })).toBe("direct");
    expect(sourceOf({})).toBe("direct");
    expect(sourceOf({ ref: "https://news.ycombinator.com/item?id=1" })).toBe("other");
    expect(sourceOf({ ref: "not a url" })).toBe("other");
    expect(sourceOf({ ref: "javascript:alert(1)" })).toBe("other");
    // a lookalike host is another site
    expect(sourceOf({ ref: "https://sagepays.xyz.evil.example/earn" })).toBe("other");
  });

  it("counts a staging host as Sage's own when it is told about it", () => {
    expect(sourceOf({ ref: "http://localhost:3000/earn" }, ["sagepays.xyz", "localhost"])).toBe("earn");
  });
});

describe("a crawler is not a visitor", () => {
  it("leaves out bots, previews and scripts, and anything with no user agent", () => {
    for (const ua of ["", "Twitterbot/1.0", "TelegramBot (like TwitterBot)", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "facebookexternalhit/1.1", "curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/120", "Slackbot-LinkExpanding 1.0"]) {
      expect(looksLikeBot(ua), ua).toBe(true);
    }
    expect(looksLikeBot(null)).toBe(true);
  });
  it("keeps real browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(looksLikeBot(ua), ua).toBe(false);
    }
  });
});

describe("the funnel", () => {
  it("counts people at each stage, and each stage holds everyone who got further", () => {
    const input: FunnelInput = {
      visits: [
        visit({ visitor: "a" }),
        visit({ visitor: "b" }),
        visit({ visitor: "c", wallet: W(1), signedInAt: 110 }),
        visit({ visitor: "d", wallet: W(2), signedInAt: 110, openedAt: 120 }),
        visit({ visitor: "e", wallet: W(3), signedInAt: 110, openedAt: 120 }),
        visit({ visitor: "f", wallet: W(4), signedInAt: 110, openedAt: 120 }),
      ],
      answers: [
        { wallet: W(3), state: "open" },
        { wallet: W(4), state: "paid" },
      ],
      seats: [],
    };
    expect(counts(input)).toEqual([6, 4, 3, 2, 1]);
    expect(buildFunnel(input).stages.map((s) => s.label)).toEqual(["Saw the test", "Signed in to take part", "Opened your product", "Answered", "Paid for an honest try"]);
    expect(buildFunnel(input).tracked).toBe(true);
  });

  it("counts someone who answered with no visit on record as having seen, signed in and opened", () => {
    const input: FunnelInput = { visits: [visit({ visitor: "a" })], answers: [{ wallet: W(9), state: "paid" }], seats: [] };
    expect(counts(input)).toEqual([2, 1, 1, 1, 1]);
  });

  it("never rises from one stage to the next, whatever the rows say", () => {
    const input: FunnelInput = {
      // opened the product without signing in: they got at least as far as the stage before
      visits: [visit({ visitor: "a", openedAt: 120 }), visit({ visitor: "b" })],
      answers: [{ wallet: W(1), state: "not-paid" }, { wallet: W(2), state: "held" }],
      seats: [W(3)],
    };
    const c = counts(input);
    for (let i = 1; i < c.length; i += 1) expect(c[i]).toBeLessThanOrEqual(c[i - 1]);
    expect(c).toEqual([5, 4, 3, 2, 0]);
  });

  it("is one person for one wallet on two browsers, and for two answers from one wallet", () => {
    const input: FunnelInput = {
      visits: [visit({ visitor: "phone", wallet: W(1), signedInAt: 110 }), visit({ visitor: "laptop", wallet: W(1).toUpperCase().replace("0X", "0x"), signedInAt: 300, openedAt: 310 })],
      answers: [{ wallet: W(1), state: "paid" }, { wallet: W(1), state: "open" }],
      seats: [W(1)],
    };
    expect(counts(input)).toEqual([1, 1, 1, 1, 1]);
  });

  it("says where the most people stopped, with the two counts", () => {
    const visits = [
      ...Array.from({ length: 11 }, (_, i) => visit({ visitor: `o${i}`, wallet: W(100 + i), signedInAt: 110, openedAt: 120 })),
      visit({ visitor: "s1" }),
    ];
    const answers = Array.from({ length: 4 }, (_, i) => ({ wallet: W(100 + i), state: "paid" as const }));
    const f = buildFunnel({ visits, answers, seats: [] });
    expect(f.stop).toEqual({ after: "opened", people: 7, line: "Most people who stopped did so after opening your product: 11 opened it, 4 answered." });
  });

  it("does not say 'most' when the biggest stop is not most of them", () => {
    const visits = [
      visit({ visitor: "a" }),
      visit({ visitor: "b" }),
      visit({ visitor: "c", wallet: W(1), signedInAt: 110 }),
      visit({ visitor: "d", wallet: W(2), signedInAt: 110 }),
      visit({ visitor: "e", wallet: W(3), signedInAt: 110, openedAt: 120 }),
    ];
    const f = buildFunnel({ visits, answers: [], seats: [] });
    expect(f.stop?.after).toBe("saw");
    expect(f.stop?.line).toBe("More people stopped after seeing the test than anywhere else: 5 saw it, 3 signed in.");
  });

  it("never calls an answer that is waiting or declined a stop: those are counted on their own", () => {
    const answers = [
      { wallet: W(1), state: "held" as const },
      { wallet: W(2), state: "not-paid" as const },
      { wallet: W(3), state: "open" as const },
      { wallet: W(4), state: "paid" as const },
    ];
    const f = buildFunnel({ visits: [], answers, seats: [] });
    expect(f.stop).toBeNull();
    expect(f.held).toBe(1);
    expect(f.notPaid).toBe(1);
    // no visit rows at all: the test predates tracking, and the page says visits were not counted
    expect(f.tracked).toBe(false);
    expect(funnelLine(f)).toBeNull();
  });

  it("is empty and has no stop when nobody came", () => {
    const f = buildFunnel({ visits: [], answers: [], seats: [] });
    expect(f.stages.map((s) => s.people)).toEqual([0, 0, 0, 0, 0]);
    expect(f.stop).toBeNull();
  });

  it("reads as one line on a card", () => {
    const f = buildFunnel({ visits: [visit({ visitor: "a" }), visit({ visitor: "b", wallet: W(1), signedInAt: 1 })], answers: [{ wallet: W(1), state: "paid" }], seats: [] });
    expect(funnelLine(f)).toBe("2 saw it · 1 answered · 1 paid");
  });
});

describe("where people came from", () => {
  it("is each person's first touch, most first, with empty sources left out", () => {
    const input: FunnelInput = {
      visits: [
        visit({ visitor: "a", source: "x" }),
        visit({ visitor: "b", source: "x", wallet: W(1), signedInAt: 110 }),
        visit({ visitor: "c", source: "x", wallet: W(2), signedInAt: 110 }),
        visit({ visitor: "d", source: "earn", wallet: W(3), signedInAt: 110 }),
        // the same person came back from Telegram later: their first touch still counts
        visit({ visitor: "d2", source: "telegram", wallet: W(3), firstAt: 900, signedInAt: 900 }),
        visit({ visitor: "e", source: "something-old" }),
      ],
      answers: [
        { wallet: W(1), state: "paid" },
        { wallet: W(3), state: "open" },
        // answered with no visit on record
        { wallet: W(7), state: "paid" },
      ],
      seats: [W(8)],
    };
    expect(buildSources(input)).toEqual([
      { source: "x", label: "Sage's post on X", saw: 3, answered: 1, paid: 1 },
      { source: "earn", label: "Earn, Sage's list of open tests", saw: 1, answered: 1, paid: 0 },
      { source: "direct", label: "Direct or unknown", saw: 1, answered: 1, paid: 1 },
      { source: "link", label: "Your own link", saw: 1, answered: 0, paid: 0 },
      { source: "other", label: "Other sites", saw: 1, answered: 0, paid: 0 },
    ]);
  });

  it("adds up to the people who saw the test", () => {
    const input: FunnelInput = { visits: [visit({ visitor: "a", source: "x" }), visit({ visitor: "b", source: "tg-unknown" })], answers: [{ wallet: W(1), state: "paid" }], seats: [W(2)] };
    expect(buildSources(input).reduce((n, r) => n + r.saw, 0)).toBe(buildFunnel(input).stages[0].people);
  });
});
