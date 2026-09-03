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
    for (const host of ["x.com", "twitter.com", "www.linkedin.com"]) {
      const r = matchArtifact({ status: 200, finalUrl: `https://${host}/someone/status/1`, bodyText: `<p>${WALLET}</p>` }, anyHost, WALLET);
      expect(r.verified, host).toBe(false);
      expect(r.publicDetail, host).toMatch(/can't read posts on .*need a sign-in/);
    }
    expect(UNREADABLE_HOSTS).toContain("x.com");
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
