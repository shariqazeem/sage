import { describe, expect, it } from "vitest";
import { parseWorkProofContract, runWorkProof } from "./work-proof";

/**
 * The first public gig (2026-09-03): a tweet with no wallet on it reached the MODEL because the
 * contract parser refused an any-host artifact contract (empty allowedHosts) as "not a contract",
 * so the deterministic marker check never ran. The verifier treats an empty list as "publish
 * anywhere"; the parser now agrees, and a marker-less page is refused before any model.
 */
const anyHost = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };
const A = "0x270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de";

describe("any-host artifact contracts run the deterministic lane", () => {
  it("parses an empty allow-list as a contract", () => {
    expect(parseWorkProofContract(anyHost)?.kind).toBe("artifact_url");
    expect(parseWorkProofContract({ kind: "artifact_url", markerKind: "wallet" })).toBeNull(); // no list at all is still malformed
  });
  it("refuses a page without the submitter's wallet before any model is consulted", async () => {
    const fetchImpl = (async () => new Response("<html>Paid privately through Sage — a tweet with no wallet on it</html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const tweet = await runWorkProof(anyHost as never, { wallet: A, evidenceUrl: "https://x.com/someone/status/1", note: null }, { fetchImpl });
    expect(tweet.outcome).toBe("definitive");
    // a post on a host Sage cannot read is refused for THAT reason — the worker learns a post could never work
    expect(tweet.result.detail).toMatch(/unreadable host x\.com/);
    expect(tweet.result.publicDetail).toMatch(/can't read posts on x\.com/);
    const page = await runWorkProof(anyHost as never, { wallet: A, evidenceUrl: "https://blog.example/post", note: null }, { fetchImpl });
    expect(page.outcome).toBe("definitive");
    expect(page.result.detail).toMatch(/marker absent/);
  });
});
