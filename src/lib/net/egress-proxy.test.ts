import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startEgressProxy } from "./egress-proxy";

/**
 * Direct adversarial tests for the egress proxy (no browser). Each attack routes a request THROUGH the
 * proxy and proves the INTERNAL fixture server receives ZERO requests — the proxy resolves, validates, and
 * pins every destination and fails closed. The injected `lookup` simulates malicious DNS (rebinding, mixed
 * records, private answers) without touching real DNS.
 */
let internal: { origin: string; port: number; hits: () => number; reset: () => void; close: () => Promise<void> };
let evidence: { origin: string; port: number; hits: () => number; close: () => Promise<void> };

async function fixture(handler: http.RequestListener) {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; handler(req, res); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, port, hits: () => hits, reset: () => { hits = 0; }, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Send an HTTP request THROUGH the forward proxy; resolve with the status the client observed (403=blocked). */
function proxyHttp(proxyPort: number, absoluteUrl: string, method = "GET"): Promise<number> {
  return new Promise((resolve) => {
    const u = new URL(absoluteUrl);
    const r = http.request({ host: "127.0.0.1", port: proxyPort, method, path: absoluteUrl, headers: { host: u.host }, timeout: 4000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on("timeout", () => { r.destroy(); resolve(0); });
    r.on("error", () => resolve(0));
    r.end();
  });
}

/** Attempt a CONNECT tunnel THROUGH the proxy; resolve true iff the tunnel was established (200). */
function proxyConnect(proxyPort: number, hostPort: string): Promise<boolean> {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: hostPort, timeout: 4000 });
    // 'connect' fires for ANY CONNECT response — a real tunnel is 200; a refusal is 403.
    r.on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode === 200); });
    r.on("response", (res) => resolve(res.statusCode === 200));
    r.on("timeout", () => { r.destroy(); resolve(false); });
    r.on("error", () => resolve(false));
    r.end();
  });
}

beforeAll(async () => {
  internal = await fixture((_q, res) => { res.writeHead(200); res.end("INTERNAL SECRET DATA"); });
  evidence = await fixture((_q, res) => { res.writeHead(200); res.end("evidence ok"); });
});
afterAll(async () => { await internal.close(); await evidence.close(); });
beforeEach(() => internal.reset());

describe("egress proxy — every attack reaches the internal server ZERO times", () => {
  it("blocks a private IPv4 literal destination", async () => {
    const p = await startEgressProxy();
    expect(await proxyHttp(p.port, "http://10.0.0.1/x")).toBe(403);
    expect(await proxyHttp(p.port, "http://192.168.1.1/x")).toBe(403);
    expect(p.stats.blocked).toBeGreaterThanOrEqual(2);
    await p.close();
  });

  it("blocks the cloud-metadata address 169.254.169.254", async () => {
    const p = await startEgressProxy();
    expect(await proxyHttp(p.port, "http://169.254.169.254/latest/meta-data/")).toBe(403);
    await p.close();
  });

  it("blocks weird IPv4 encodings that canonicalize to loopback (hex/integer)", async () => {
    const p = await startEgressProxy({ allowedPorts: new Set([80, 443, internal.port]) });
    expect(await proxyHttp(p.port, `http://0x7f000001:${internal.port}/`)).toBe(403);
    expect(await proxyHttp(p.port, `http://2130706433:${internal.port}/`)).toBe(403);
    expect(internal.hits()).toBe(0);
    await p.close();
  });

  it("blocks an IPv4-mapped IPv6 loopback literal", async () => {
    const p = await startEgressProxy({ allowedPorts: new Set([80, 443, internal.port]) });
    expect(await proxyHttp(p.port, `http://[::ffff:127.0.0.1]:${internal.port}/`)).toBe(403);
    expect(internal.hits()).toBe(0);
    await p.close();
  });

  it("blocks a hostname that RESOLVES to loopback (validates the resolved IP, not the name)", async () => {
    let calls = 0;
    const p = await startEgressProxy({
      allowedPorts: new Set([80, 443, internal.port]),
      lookup: async (host) => { calls++; return host === "internal.attacker.test" ? [{ address: "127.0.0.1", family: 4 }] : []; },
    });
    expect(await proxyHttp(p.port, `http://internal.attacker.test:${internal.port}/`)).toBe(403);
    expect(internal.hits()).toBe(0);
    expect(calls).toBe(1); // resolved exactly once, then pinned — no TOCTOU re-resolution
    await p.close();
  });

  it("blocks MIXED public/private DNS answers (refuses the whole host)", async () => {
    const p = await startEgressProxy({
      allowedPorts: new Set([80, 443, internal.port]),
      lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }],
    });
    expect(await proxyHttp(p.port, `http://mixed.attacker.test:${internal.port}/`)).toBe(403);
    expect(internal.hits()).toBe(0);
    await p.close();
  });

  it("DNS-rebinding: pins the single resolved answer and never re-resolves to reach internal", async () => {
    // The malicious resolver would hand back internal (loopback) — the proxy validates that resolved
    // answer and refuses. It resolves ONCE per connection, so a "public-then-private" flip cannot slip a
    // private target past a public validation.
    let calls = 0;
    const p = await startEgressProxy({
      allowedPorts: new Set([80, 443, internal.port]),
      lookup: async () => { calls++; return [{ address: "127.0.0.1", family: 4 }]; },
    });
    expect(await proxyHttp(p.port, `http://rebind.attacker.test:${internal.port}/`)).toBe(403);
    expect(internal.hits()).toBe(0);
    expect(calls).toBe(1);
    await p.close();
  });

  it("blocks a non-approved port even to a public host", async () => {
    const p = await startEgressProxy({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
    expect(await proxyHttp(p.port, "http://public.test:8080/")).toBe(403); // 8080 not in {80,443}
    await p.close();
  });

  it("blocks state-changing methods over plain HTTP", async () => {
    const p = await startEgressProxy({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
    expect(await proxyHttp(p.port, "http://public.test/", "POST")).toBe(403);
    expect(await proxyHttp(p.port, "http://public.test/", "DELETE")).toBe(403);
    await p.close();
  });

  it("blocks a non-http(s) scheme", async () => {
    const p = await startEgressProxy();
    expect(await proxyHttp(p.port, "ftp://public.test/")).toBe(403);
    await p.close();
  });

  it("CONNECT to a private/loopback destination is refused (no tunnel, internal untouched)", async () => {
    const p = await startEgressProxy({ allowedPorts: new Set([443, internal.port]) });
    expect(await proxyConnect(p.port, `127.0.0.1:${internal.port}`)).toBe(false);
    expect(await proxyConnect(p.port, "10.0.0.1:443")).toBe(false);
    expect(internal.hits()).toBe(0);
    await p.close();
  });

  it("is NOT a blanket-deny: an allowlisted fixture origin is forwarded (proves the proxy actually works)", async () => {
    const p = await startEgressProxy({
      allowedPorts: new Set([80, 443, evidence.port]),
      allowLoopback: new Set([`127.0.0.1:${evidence.port}`]),
    });
    expect(await proxyHttp(p.port, `http://127.0.0.1:${evidence.port}/`)).toBe(200);
    expect(evidence.hits()).toBeGreaterThan(0);
    expect(p.stats.allowed).toBeGreaterThan(0);
    await p.close();
  });
});
