import { describe, expect, it, vi } from "vitest";
import { GUARDED_HEADERS, guardedFetchPage, type Lookup } from "./guarded-fetch";
import { verifyArtifactUrl } from "@/lib/verify/verifiers";
import { fetchEvidence } from "@/lib/deputy/evidence";

/**
 * THE GUARDED READ, held against the attacks a submitted link can carry.
 *
 * The deterministic checkers decide whether work is PAID. Until 5 Nov 2026 they fetched worker links with
 * redirect:"follow", no timeout and no size cap, and with a different request identity than the judge.
 */
const publicDns: Lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });

describe("guardedFetchPage", () => {
  it("refuses a public name that resolves to a private address (rebinding, 127.0.0.1.nip.io)", async () => {
    const f = vi.fn(async () => html("secret"));
    const r = await guardedFetchPage("https://looks-public.example.com/", { fetchImpl: f as unknown as typeof fetch, lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(r.ok).toBe(false);
    expect(r.failReason).toMatch(/private/);
    expect(f).not.toHaveBeenCalled(); // never connected
  });

  it("refuses a mixed answer: one private record is enough", async () => {
    const r = await guardedFetchPage("https://mixed.example.com/", {
      fetchImpl: vi.fn() as unknown as typeof fetch,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }],
    });
    expect(r.ok).toBe(false);
  });

  it("re-checks every redirect hop: a bounce to the cloud metadata address is refused", async () => {
    const f = vi.fn(async (url: string) =>
      url.startsWith("https://evil.example.com")
        ? new Response("", { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } })
        : html("metadata"),
    );
    const r = await guardedFetchPage("https://evil.example.com/work", { fetchImpl: f as unknown as typeof fetch, lookup: publicDns });
    expect(r.ok).toBe(false);
    expect(r.failReason).toMatch(/blocked redirect/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("re-checks a redirect hop's DNS too", async () => {
    const lookup: Lookup = async (host) => (host === "inner.example.com" ? [{ address: "192.168.1.10", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
    const f = vi.fn(async (url: string) =>
      url.startsWith("https://outer.example.com") ? new Response("", { status: 301, headers: { location: "https://inner.example.com/" } }) : html("internal"),
    );
    const r = await guardedFetchPage("https://outer.example.com/", { fetchImpl: f as unknown as typeof fetch, lookup });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caps redirects", async () => {
    const f = vi.fn(async (url: string) => new Response("", { status: 302, headers: { location: `${url}x` } }));
    const r = await guardedFetchPage("https://loop.example.com/a", { fetchImpl: f as unknown as typeof fetch, lookup: publicDns, maxRedirects: 2 });
    expect(r.failReason).toBe("too many redirects");
  });

  it("times out a page that never finishes, as a transient failure (retry later, never fail the work)", async () => {
    const f = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise<Response>((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const r = await guardedFetchPage("https://slow.example.com/", { fetchImpl: f as unknown as typeof fetch, lookup: publicDns, timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(true);
    expect(r.failReason).toBe("timeout");
  });

  it("refuses an oversized body, or keeps its head when asked to truncate", async () => {
    const big = "a".repeat(5_000);
    const strict = await guardedFetchPage("https://big.example.com/", { fetchImpl: vi.fn(async () => html(big)) as unknown as typeof fetch, lookup: publicDns, maxBytes: 1_000 });
    expect(strict.failReason).toBe("oversized");
    const kept = await guardedFetchPage("https://big.example.com/", { fetchImpl: vi.fn(async () => html(big)) as unknown as typeof fetch, lookup: publicDns, maxBytes: 1_000, truncate: true });
    expect(kept.ok).toBe(true);
    expect(kept.body.length).toBe(1_000);
  });

  it("sends the same request identity as the judge's evidence fetch, so a page can't cloak by user agent", async () => {
    const seen: Record<string, string>[] = [];
    const f = vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return html(`<p>wallet 0x${"a".repeat(40)}</p>`);
    });
    await guardedFetchPage("https://page.example.com/", { fetchImpl: f as unknown as typeof fetch, lookup: publicDns });
    await fetchEvidence("https://page.example.com/", { fetchImpl: f as unknown as typeof fetch, lookup: publicDns });
    expect(seen).toHaveLength(2);
    expect(seen[0]["user-agent"]).toBe(seen[1]["user-agent"]);
    expect(seen[0]["user-agent"]).toBe(GUARDED_HEADERS["user-agent"]);
  });
});

describe("the payout checkers read through the guard", () => {
  it("an artifact link that resolves privately is refused, not fetched", async () => {
    const f = vi.fn(async () => html("x"));
    // The checker passes its injected fetch; DNS is part of production's real fetch. Proven above for
    // the reader itself. Here: a literal private host never reaches fetch at all.
    const r = await verifyArtifactUrl({ kind: "artifact_url", allowedHosts: [], markerKind: "wallet" } as never, "https://127.0.0.1/admin", `0x${"a".repeat(40)}`, { fetchImpl: f as unknown as typeof fetch, render: null });
    expect(r.verified).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("the judge's evidence fetch refuses a name that resolves privately", async () => {
    const f = vi.fn(async () => html("internal"));
    const r = await fetchEvidence("https://127.0.0.1.nip.io/", { fetchImpl: f as unknown as typeof fetch, lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
