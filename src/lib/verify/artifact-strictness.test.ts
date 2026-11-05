import { describe, expect, it } from "vitest";
import { matchArtifact, UNREADABLE_HOSTS } from "./verifiers";
import { fingerprintSimilarity } from "@/lib/deputy/fingerprint";
import type { ArtifactUrlContract } from "./contract";

const WALLET = "0x1d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e0000000000000";
const anyHost: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };
const shell = (article: string) =>
  `<html><body><nav>${Array.from({ length: 40 }, (_, i) => `<a href="/${i}">Site link ${i} trending</a>`).join("")}</nav><main>${article}</main><footer>${"footer words ".repeat(80)}</footer></body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("artifact strictness — checked before any model reads the page", () => {
  it("refuses a post on a host Sage cannot read, and says why", () => {
    for (const host of ["www.linkedin.com", "instagram.com", "facebook.com"]) {
      const r = matchArtifact({ status: 200, finalUrl: `https://${host}/someone/status/1`, bodyText: `<p>${WALLET}</p>` }, anyHost, WALLET);
      expect(r.verified, host).toBe(false);
      expect(r.publicDetail, host).toMatch(/can't read posts on .*need a sign-in/);
    }
    // X posts are read through X's embed data now (read/page-reader.ts), so they are proof Sage can check
    expect(UNREADABLE_HOSTS).not.toContain("x.com");
    expect(UNREADABLE_HOSTS).toContain("linkedin.com");
  });

  it("a named allow-list is the operator's call — an allowed x.com is not second-guessed", () => {
    const r = matchArtifact({ status: 200, finalUrl: "https://x.com/me/status/1", bodyText: `<p>${WALLET}</p>` }, { ...anyHost, allowedHosts: ["x.com"] }, WALLET);
    expect(r.verified).toBe(true);
  });

  it("the word floor counts the content, not the site — and not the marker", () => {
    const c: ArtifactUrlContract = { ...anyHost, minWords: 100 };
    const thin = matchArtifact({ status: 200, finalUrl: "https://blog.example/p", bodyText: shell(`<p>${words(40)} ${WALLET}</p>`) }, c, WALLET);
    expect(thin.verified).toBe(false);
    expect(thin.publicDetail).toMatch(/about 40 words; this mission asks for at least 100/);
    const enough = matchArtifact({ status: 200, finalUrl: "https://blog.example/p", bodyText: shell(`<p>${words(120)} ${WALLET}</p>`) }, c, WALLET);
    expect(enough.verified).toBe(true);
  });

  it("a near miss on length is weighed, and a count within word-counter noise meets the floor", () => {
    const c: ArtifactUrlContract = { ...anyHost, minWords: 600 };
    const at = (n: number) => matchArtifact({ status: 200, finalUrl: "https://blog.example/p", bodyText: shell(`<p>${words(n)} ${WALLET}</p>`) }, c, WALLET);
    // under 85%: thin work, refused before any model reads it
    expect(at(500).verified).toBe(false);
    // 85-95%: verified, and the judge is told to weigh the length
    expect(at(540).verified).toBe(true);
    expect(at(540).publicDetail).toMatch(/about 540 words against the 600 asked for, so the reviewer weighs the length/);
    // within 5%: the length is met (Sage Bench, 5 Nov 2026: an excellent tutorial counted 575 was held over 25 words)
    expect(at(575).publicDetail).toMatch(/about 575 words, which meets the 600 asked for/);
    expect(at(575).publicDetail).not.toMatch(/weighs the length/);
    // at or over the floor: nothing to say
    expect(at(620).publicDetail).not.toMatch(/words/);
  });

  it("the fingerprint is of the article: two different articles on one site do not collide", () => {
    const a = matchArtifact({ status: 200, finalUrl: "https://dev.to/a/1", bodyText: shell(`<p>Sage releases funds from a Cairo vault then hides them behind a Poseidon commitment; you collect with a one-time link. ${WALLET}</p>`) }, anyHost, WALLET);
    const b = matchArtifact({ status: 200, finalUrl: "https://dev.to/b/2", bodyText: shell(`<p>Regular blockchain payouts leave a permanent searchable record of who earned what and when, which Sage treats as a privacy problem to solve. ${WALLET}</p>`) }, anyHost, WALLET);
    expect(a.verified && b.verified).toBe(true);
    expect(fingerprintSimilarity(a.artifactFingerprint, b.artifactFingerprint)).toBeLessThan(0.3);
  });

  it("a browser-rendered read supplies the content text itself", () => {
    const r = matchArtifact({ status: 200, finalUrl: "https://notion.site/p", bodyText: `nav nav nav ${WALLET} ${words(10)}`, contentText: words(150) }, { ...anyHost, minWords: 100 }, WALLET);
    expect(r.verified).toBe(true);
  });
});
