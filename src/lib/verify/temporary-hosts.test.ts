import { describe, expect, it } from "vitest";
import { matchArtifact, TEMPORARY_HOSTS } from "./verifiers";
import type { ArtifactUrlContract } from "./contract";

/** The first public gig's submissions were paste.rs pages. "Publish anywhere" means anywhere that stays. */
const A = "0x270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de";
const anyHost: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };
const body = `Sage pays privately through Sage on Starknet. My wallet: ${A}`;

describe("temporary paste hosts are not a published deliverable", () => {
  it("refuses paste.rs on an any-host contract, with a reason that names where to publish instead", () => {
    const r = matchArtifact({ status: 200, finalUrl: "https://paste.rs/N6lrJ.txt", bodyText: body }, anyHost, A);
    expect(r.verified).toBe(false);
    expect(r.detail).toMatch(/temporary host paste\.rs/);
    expect(r.publicDetail).toMatch(/somewhere that stays/);
    expect(TEMPORARY_HOSTS).toContain("pastebin.com");
  });
  it("accepts a gist, a dev.to article and a personal site", () => {
    for (const url of ["https://gist.github.com/x/abc", "https://dev.to/x/post", "https://mysite.example/post"]) {
      expect(matchArtifact({ status: 200, finalUrl: url, bodyText: body }, anyHost, A).verified).toBe(true);
    }
  });
  it("an explicit allow-list is unaffected — the operator's list decides", () => {
    const only: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: ["paste.rs"], markerKind: "wallet" };
    expect(matchArtifact({ status: 200, finalUrl: "https://paste.rs/x", bodyText: body }, only, A).verified).toBe(true);
  });
});
