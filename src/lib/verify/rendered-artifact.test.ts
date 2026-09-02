import { describe, expect, it } from "vitest";
import { verifyArtifactUrl } from "./verifiers";
import type { ArtifactUrlContract } from "./contract";

/** The first public gig: a genuine Notion write-up was held for "marker absent" because Notion renders in
 *  the browser. The artifact check now reads the page rendered when the static read misses the marker. */
const A = "0x1d9029ec00000000000000000000000000000000000000000000000000c3367c";
const anyHost: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };
const shell = (async () => new Response("<html><div id=notion-app></div><script>/* app */</script></html>", { status: 200 })) as unknown as typeof fetch;

describe("client-rendered artifact pages", () => {
  it("verifies a page whose wallet only appears once rendered", async () => {
    const render = async () => ({ text: `SAGE PRIVATE PAYOUT — paid privately through Sage. My wallet: ${A}`, finalUrl: "https://x.notion.site/p" });
    const r = await verifyArtifactUrl(anyHost, "https://x.notion.site/p", A, { fetchImpl: shell, render });
    expect(r.verified).toBe(true);
    expect(r.detail).toMatch(/browser-rendered/);
    expect(r.artifactFingerprint).toBeTruthy;
  });
  it("keeps the static verdict when the render fails or still lacks the marker", async () => {
    const dead = async () => { throw new Error("engine missing"); };
    expect((await verifyArtifactUrl(anyHost, "https://x.notion.site/p", A, { fetchImpl: shell, render: dead })).verified).toBe(false);
    const still = async () => ({ text: "a rendered page with no wallet on it", finalUrl: null });
    const r = await verifyArtifactUrl(anyHost, "https://x.notion.site/p", A, { fetchImpl: shell, render: still });
    expect(r.verified).toBe(false);
    expect(r.detail).toMatch(/marker absent/);
  });
  it("never renders when the static read already verified, or when the caller disables rendering", async () => {
    let calls = 0;
    const render = async () => { calls++; return { text: "x", finalUrl: null }; };
    const good = (async () => new Response(`page ${A}`, { status: 200 })) as unknown as typeof fetch;
    expect((await verifyArtifactUrl(anyHost, "https://blog.example/p", A, { fetchImpl: good, render })).verified).toBe(true);
    await verifyArtifactUrl(anyHost, "https://x.notion.site/p", A, { fetchImpl: shell, render: null });
    expect(calls).toBe(0);
  });
});
