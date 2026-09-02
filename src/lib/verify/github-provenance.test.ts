import { describe, expect, it } from "vitest";
import { checkGithubProvenance, parseGithubRepo, PREDATE_GRACE_SECONDS } from "./github-provenance";

const T0 = 1_756_900_000; // the campaign's createdAt
const iso = (unix: number) => new Date(unix * 1000).toISOString();
const api = (status: number, body: unknown) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("github provenance — a held signal, never a rejection, never a hold for a rate limit", () => {
  it("parses repository urls and refuses non-repositories", () => {
    expect(parseGithubRepo("https://github.com/sage-builder/api-writeup")).toEqual({ owner: "sage-builder", repo: "api-writeup" });
    expect(parseGithubRepo("https://github.com/sage-builder/api-writeup/blob/main/README.md")).toEqual({ owner: "sage-builder", repo: "api-writeup" });
    expect(parseGithubRepo("https://github.com/sage-builder/api-writeup.git")).toEqual({ owner: "sage-builder", repo: "api-writeup" });
    expect(parseGithubRepo("https://github.com/sage-builder")).toBeNull();
    expect(parseGithubRepo("https://github.com/settings/profile")).toBeNull();
    expect(parseGithubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(parseGithubRepo("not a url")).toBeNull();
  });

  it("a fork is a signal; a repository older than the gig is a signal; fresh own work is clear", async () => {
    const fork = await checkGithubProvenance("https://github.com/a/b", { campaignCreatedAt: T0, token: null, fetchImpl: api(200, { fork: true, created_at: iso(T0 + 100) }) });
    expect(fork.signal?.reason).toMatch(/fork/);
    const old = await checkGithubProvenance("https://github.com/a/b", { campaignCreatedAt: T0, token: null, fetchImpl: api(200, { fork: false, created_at: iso(T0 - PREDATE_GRACE_SECONDS - 3600) }) });
    expect(old.signal?.reason).toMatch(/before the campaign/);
    const fresh = await checkGithubProvenance("https://github.com/a/b", { campaignCreatedAt: T0, token: null, fetchImpl: api(200, { fork: false, created_at: iso(T0 + 600), pushed_at: iso(T0 + 7200) }) });
    expect(fresh.signal).toBeNull();
    expect(fresh.facts?.fork).toBe(false);
    // inside the grace window (started a few hours before the founder posted the gig) is not a signal
    const grace = await checkGithubProvenance("https://github.com/a/b", { campaignCreatedAt: T0, token: null, fetchImpl: api(200, { fork: false, created_at: iso(T0 - 3600) }) });
    expect(grace.signal).toBeNull();
  });

  it("degrades to NO signal when the API is rate-limited, missing, or unreachable", async () => {
    for (const status of [403, 404, 429, 500]) {
      const r = await checkGithubProvenance("https://github.com/a/b", { campaignCreatedAt: T0, token: null, fetchImpl: api(status, { message: "x" }) });
      expect(r.signal).toBeNull();
      expect(r.degraded).toMatch(new RegExp(String(status)));
    }
    const down = await checkGithubProvenance("https://github.com/a/b", { campaignCreatedAt: T0, token: null, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
    expect(down.signal).toBeNull();
    expect(down.degraded).toMatch(/unreachable/);
    const other = await checkGithubProvenance("https://example.com/page", { campaignCreatedAt: T0, token: null });
    expect(other.signal).toBeNull();
  });
});
