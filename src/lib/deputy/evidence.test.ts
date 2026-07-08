import { describe, expect, it, vi } from "vitest";
import { fetchEvidence, stripHtml } from "./evidence";

/** Build a minimal Response-like object (no body stream → arrayBuffer path). */
function res(init: {
  status?: number;
  location?: string;
  contentType?: string;
  contentLength?: number | null;
  body?: string;
  bytes?: Uint8Array;
}): Response {
  const h = new Map<string, string>();
  if (init.location) h.set("location", init.location);
  h.set("content-type", init.contentType ?? "text/html");
  if (init.contentLength != null) h.set("content-length", String(init.contentLength));
  const bytes = init.bytes ?? new TextEncoder().encode(init.body ?? "");
  return {
    status: init.status ?? 200,
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    body: null,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

/** A fetch mock that returns queued responses in order and records call count. */
function queuedFetch(responses: Response[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    const r = responses[calls.length - 1];
    if (!r) throw new Error("unexpected extra fetch");
    return r;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("stripHtml", () => {
  it("removes tags + scripts and collapses whitespace", () => {
    const out = stripHtml(
      "<html><head><style>x{}</style></head><body><script>bad()</script><p>Hello   <b>world</b></p></body></html>",
    );
    expect(out).toBe("Hello world");
  });
});

describe("fetchEvidence — size cap", () => {
  it("flags an oversized body as a signal (ok:false), not an exception", async () => {
    const big = new Uint8Array(300 * 1024); // > 250KB
    const { fetchImpl } = queuedFetch([res({ status: 200, bytes: big })]);
    const r = await fetchEvidence("https://example.org/huge", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.failReason).toBe("oversized");
    expect(r.text).toBe("");
  });

  it("returns readable text under the cap", async () => {
    const { fetchImpl } = queuedFetch([
      res({ status: 200, body: "<p>real <b>evidence</b> here</p>" }),
    ]);
    const r = await fetchEvidence("https://example.org/ok", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("real evidence here");
    expect(r.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("fetchEvidence — redirect revalidation", () => {
  it("refuses a redirect to a blocked (metadata) host and does NOT follow it", async () => {
    const { fetchImpl, calls } = queuedFetch([
      res({ status: 302, location: "https://169.254.169.254/latest/meta-data" }),
    ]);
    const r = await fetchEvidence("https://example.org/start", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.failReason).toMatch(/blocked redirect/);
    expect(calls).toHaveLength(1); // never fetched the blocked host
  });

  it("follows a redirect to an allowed host, re-validated", async () => {
    const { fetchImpl, calls } = queuedFetch([
      res({ status: 302, location: "https://example.org/final" }),
      res({ status: 200, body: "<p>final page</p>" }),
    ]);
    const r = await fetchEvidence("https://example.com/start", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("final page");
    expect(calls).toHaveLength(2);
  });

  it("stops after the redirect limit", async () => {
    const { fetchImpl, calls } = queuedFetch([
      res({ status: 302, location: "https://example.org/1" }),
      res({ status: 302, location: "https://example.org/2" }),
      res({ status: 302, location: "https://example.org/3" }),
    ]);
    const r = await fetchEvidence("https://example.com/start", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.failReason).toBe("too many redirects");
    expect(calls).toHaveLength(3); // 2 followed, 3rd refused
  });
});
