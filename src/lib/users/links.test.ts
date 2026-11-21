import { describe, expect, it } from "vitest";
import { hnSubmit, linkedinShare, mailto, redditSubmit, telegramShare, whatsappShare, xIntent, xProfile } from "./links";

/** Each channel's own share link, with the builder's words carried whole. No key, nothing sent. */
const URL_ = "https://dropkit.app/?ref=a&b=1";
const TEXT = `I paid 10 strangers to try Dropkit & co.\n\n${URL_}`;

describe("share links", () => {
  it("opens X's own compose screen with the text", () => {
    const u = new URL(xIntent(TEXT));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe(TEXT);
  });
  it("gives LinkedIn the link alone", () => {
    const u = new URL(linkedinShare(URL_));
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/sharing/share-offsite/");
    expect([...u.searchParams.keys()]).toEqual(["url"]);
    expect(u.searchParams.get("url")).toBe(URL_);
  });
  it("gives Reddit and Hacker News the link and a title", () => {
    const r = new URL(redditSubmit(URL_, "A title: 7 of 10"));
    expect(r.origin + r.pathname).toBe("https://www.reddit.com/submit");
    expect(r.searchParams.get("url")).toBe(URL_);
    expect(r.searchParams.get("title")).toBe("A title: 7 of 10");
    const h = new URL(hnSubmit(URL_, "Show HN: Dropkit – drops"));
    expect(h.origin + h.pathname).toBe("https://news.ycombinator.com/submitlink");
    expect(h.searchParams.get("u")).toBe(URL_);
    expect(h.searchParams.get("t")).toBe("Show HN: Dropkit – drops");
  });
  it("sends Telegram the link once, lifted out of the words", () => {
    const u = new URL(telegramShare(URL_, TEXT));
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe(URL_);
    expect(u.searchParams.get("text")).toBe("I paid 10 strangers to try Dropkit & co.");
  });
  it("sends WhatsApp the whole text", () => {
    expect(new URL(whatsappShare(TEXT)).searchParams.get("text")).toBe(TEXT);
  });
});

describe("mailto", () => {
  it("puts everyone in BCC and nobody in To, and keeps line breaks", () => {
    const href = mailto({ bcc: ["a@x.co", " b@y.org ", "a@x.co", "not an address", "evil@x.co,other@z.co"], subject: "An update & more", body: "Hi,\n\nThanks." });
    expect(href.startsWith("mailto:?bcc=a%40x.co,b%40y.org&subject=")).toBe(true);
    expect(href).toContain("subject=An%20update%20%26%20more");
    expect(href).toContain("body=Hi%2C%0D%0A%0D%0AThanks.");
    expect(href).not.toContain("evil");
  });
  it("is a plain compose link with nobody addressed when there is no list", () => {
    expect(mailto({ subject: "s", body: "b" })).toBe("mailto:?subject=s&body=b");
  });
});

describe("xProfile", () => {
  it("links a handle and refuses anything that is not one", () => {
    expect(xProfile("@maria_k")).toBe("https://x.com/maria_k");
    expect(xProfile("maria_k")).toBe("https://x.com/maria_k");
    expect(xProfile("@maria/../../evil")).toBeNull();
    expect(xProfile("https://evil.example")).toBeNull();
    expect(xProfile("")).toBeNull();
  });
});
