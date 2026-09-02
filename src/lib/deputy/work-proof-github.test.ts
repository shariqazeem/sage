import { describe, expect, it } from "vitest";
import { runWorkProof } from "./work-proof";
import type { ArtifactUrlContract } from "@/lib/verify/contract";

/**
 * Through the real work-proof lane: a github artifact that verifies (live, marked) but is a FORK is
 * held with a plain reason; the same artifact with a rate-limited API is verified — the limit is
 * GitHub's problem, never the tester's.
 */
const A = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const contract: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: ["github.com"], markerKind: "wallet" };
const T0 = 1_756_900_000;
const page = `<html><body>API write-up for the gig. Authentication, campaigns, submit and proof endpoints are documented with examples for curl and fetch. Rate limits and error shapes included. Marker: ${A}</body></html>`;
function fetchFor(apiStatus: number, apiBody: unknown): typeof fetch {
  return (async (input: string | URL | Request) => {
    const u = String(input);
    if (u.startsWith("https://api.github.com/")) return new Response(JSON.stringify(apiBody), { status: apiStatus, headers: { "content-type": "application/json" } });
    return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

describe("work-proof + github provenance", () => {
  it("holds a verified artifact that is a fork, with a founder-readable reason", async () => {
    const out = await runWorkProof(contract, { wallet: A, evidenceUrl: "https://github.com/x/y", note: "done", campaignCreatedAt: T0 }, { fetchImpl: fetchFor(200, { fork: true, created_at: new Date((T0 + 60) * 1000).toISOString() }) });
    expect(out.outcome).toBe("definitive");
    expect(out.result.detail).toMatch(/github provenance: repository is a fork/);
    expect(out.result.publicDetail).toMatch(/held for the founder's review/);
  });

  it("verifies fresh own work, and still verifies when the API is rate-limited", async () => {
    const fresh = await runWorkProof(contract, { wallet: A, evidenceUrl: "https://github.com/x/y", note: "done", campaignCreatedAt: T0 }, { fetchImpl: fetchFor(200, { fork: false, created_at: new Date((T0 + 60) * 1000).toISOString() }) });
    expect(fresh.outcome).toBe("verified");
    const limited = await runWorkProof(contract, { wallet: A, evidenceUrl: "https://github.com/x/y", note: "done", campaignCreatedAt: T0 }, { fetchImpl: fetchFor(403, { message: "rate limit" }) });
    expect(limited.outcome).toBe("verified");
    // no campaign age known (legacy caller) → no provenance consulted, verification unchanged
    const legacy = await runWorkProof(contract, { wallet: A, evidenceUrl: "https://github.com/x/y", note: "done" }, { fetchImpl: fetchFor(200, { fork: true, created_at: "2020-01-01T00:00:00Z" }) });
    expect(legacy.outcome).toBe("verified");
  });
});
