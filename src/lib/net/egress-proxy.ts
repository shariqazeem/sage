import "server-only";

import http from "node:http";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { isPublicIp, isIpLiteral, classifyIp } from "./ip-classify";

/**
 * The AUTHORITATIVE egress boundary for untrusted browser contexts (Gate C item 4).
 *
 * Every request a headless Chromium makes — top-level navigation, redirects, scripts/images/fetch/XHR,
 * WebSockets, EventSource, workers, beacons — is routed through this one local forward proxy (Chromium is
 * launched with `--proxy-server` pointing here and `--proxy-bypass-list=<-loopback>` so nothing, not even
 * loopback, escapes it). The browser NEVER does its own DNS or opens its own sockets, which closes the
 * TOCTOU / DNS-rebinding window a Node preflight leaves open: this proxy RESOLVES each destination itself,
 * validates that EVERY resolved address is plain global unicast, and CONNECTS to the pinned validated IP
 * (preserving the hostname for the Host header / TLS SNI). A hostname whose records are a mix of public
 * and private is refused. Each redirect hop is a fresh proxy request, so every hop is validated anew.
 *
 * Policy: only http/https, only approved ports (80/443), only read-only methods over plain HTTP
 * (state-changing methods are refused; over HTTPS the method is encrypted, so the destination guard —
 * public-only — is the operative defense). Bounded bytes, time, and concurrency. FAILS CLOSED on any
 * resolution/validation/parse error. It only ever REFUSES; it can never broaden what the browser reaches.
 */

export interface EgressProxyOptions {
  /** approved destination ports. Default {80, 443}. */
  allowedPorts?: ReadonlySet<number>;
  /** approved HTTP methods (plain-HTTP only; HTTPS is opaque). Default {GET, HEAD}. */
  allowMethods?: ReadonlySet<string>;
  /** per-connection byte cap. Default 12 MB. */
  maxBytes?: number;
  /** per-connection wall-clock cap. Default 30s. */
  maxMs?: number;
  /** max concurrent upstream connections. Default 24. */
  maxConcurrent?: number;
  /** TEST-ONLY DNS override. Production uses node:dns. Lets a test simulate rebinding / mixed records. */
  lookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  /** TEST-ONLY exact "host:port" destinations allowed despite being loopback (integration fixtures). Not
   *  reachable in production — production passes nothing here, so loopback is always refused. */
  allowLoopback?: ReadonlySet<string>;
  /** optional structured event sink (audit/metrics). Never receives request bodies or page content. */
  onEvent?: (e: EgressEvent) => void;
}

export interface EgressEvent {
  kind: "allow" | "block";
  method: string;
  host: string;
  port: number;
  reason: string; // short machine reason; never raw content
  addressClass?: string;
}

export interface GuardedProxy {
  /** the proxy origin to hand Chromium, e.g. "http://127.0.0.1:54321". */
  url: string;
  port: number;
  /** Chromium args that force ALL traffic (incl. loopback) through the proxy. */
  chromiumArgs: string[];
  stats: { allowed: number; blocked: number; blockedByReason: Record<string, number> };
  close: () => Promise<void>;
}

const DEFAULT_PORTS = new Set([80, 443]);
const DEFAULT_METHODS = new Set(["GET", "HEAD"]);

export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<GuardedProxy> {
  const allowedPorts = opts.allowedPorts ?? DEFAULT_PORTS;
  const allowMethods = opts.allowMethods ?? DEFAULT_METHODS;
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  const maxMs = opts.maxMs ?? 30_000;
  const maxConcurrent = opts.maxConcurrent ?? 24;
  const allowLoopback = opts.allowLoopback ?? new Set<string>();
  const lookup =
    opts.lookup ??
    (async (host: string) => (await dnsLookup(host, { all: true })).map((r) => ({ address: r.address, family: r.family })));

  const stats: GuardedProxy["stats"] = { allowed: 0, blocked: 0, blockedByReason: {} };
  let live = 0;
  // Track every socket (incoming client + upstream) so close() can force them down — otherwise a lingering
  // keep-alive to a fixture makes that fixture's server.close() hang.
  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket | null | undefined) => {
    if (!s) return;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };
  const emit = (e: EgressEvent) => {
    if (e.kind === "allow") stats.allowed++;
    else {
      stats.blocked++;
      stats.blockedByReason[e.reason] = (stats.blockedByReason[e.reason] ?? 0) + 1;
    }
    opts.onEvent?.(e);
  };

  /** Resolve + validate + pin. Returns the IP to connect to, or a block reason. */
  async function pin(host: string, port: number): Promise<{ ip: string } | { block: string; cls?: string }> {
    if (allowLoopback.has(`${host}:${port}`)) return { ip: host }; // TEST-ONLY fixture origin (bypasses port + IP checks)
    if (!allowedPorts.has(port)) return { block: "port_not_allowed" };
    if (isIpLiteral(host)) {
      // an IP literal (any encoding ipaddr.js canonicalizes) — classify directly, no DNS.
      return isPublicIp(host) ? { ip: host } : { block: "private_ip_literal", cls: classifyIp(host) };
    }
    let recs: { address: string; family: number }[];
    try {
      recs = await lookup(host);
    } catch {
      return { block: "dns_error" };
    }
    if (!recs.length) return { block: "dns_empty" };
    // MIXED-RECORD defense: EVERY resolved address must be public, else refuse the whole host.
    for (const r of recs) {
      if (!isPublicIp(r.address)) return { block: "resolves_private", cls: classifyIp(r.address) };
    }
    return { ip: recs[0].address }; // pin the first validated public address
  }

  // ── plain HTTP forward ─────────────────────────────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    void handleHttp(req, res);
  });

  async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = (req.method ?? "GET").toUpperCase();
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      return refuse(res, "bad_request", method, "?", 0);
    }
    const host = target.hostname;
    const port = target.port ? Number(target.port) : 80;
    if (target.protocol !== "http:") return refuse(res, "scheme_not_allowed", method, host, port);
    if (!allowMethods.has(method)) return refuse(res, "method_not_allowed", method, host, port);
    if (live >= maxConcurrent) return refuse(res, "too_many_connections", method, host, port);

    const decision = await pin(host, port);
    if ("block" in decision) {
      emit({ kind: "block", method, host, port, reason: decision.block, addressClass: decision.cls });
      res.writeHead(403).end(); // empty body: a blocked request must not inject capturable content
      return;
    }
    emit({ kind: "allow", method, host, port, reason: "ok" });
    live++;
    track(req.socket);
    let released = false;
    const done = () => { if (!released) { released = true; live = Math.max(0, live - 1); } };
    // agent:false → no keep-alive pooling, so each upstream socket closes after its response (live counting
    // stays accurate and no socket lingers). live is released on the CLIENT response finishing, per request.
    const upstream = http.request(
      { host: decision.ip, port, method, path: target.pathname + target.search, headers: { ...req.headers, host: target.host, connection: "close" }, agent: false },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        let bytes = 0;
        up.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            up.destroy();
            res.destroy();
          }
        });
        up.pipe(res);
      },
    );
    upstream.on("socket", track);
    const killer = setTimeout(() => upstream.destroy(new Error("egress timeout")), maxMs);
    res.on("close", () => { clearTimeout(killer); done(); });
    upstream.on("error", () => { done(); try { res.writeHead(502).end(); } catch { /* headers sent */ } });
    req.pipe(upstream);
  }

  function refuse(res: http.ServerResponse, reason: string, method: string, host: string, port: number) {
    emit({ kind: "block", method, host, port, reason });
    res.writeHead(403).end("blocked");
  }

  // ── HTTPS via CONNECT tunnel ───────────────────────────────────────────────────────────────────────
  server.on("connect", (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    void handleConnect(req, clientSocket, head);
  });

  async function handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) {
    const [rawHost, rawPort] = (req.url ?? "").split(":");
    const host = rawHost ?? "";
    const port = Number(rawPort ?? 443);
    const kill = (reason: string) => {
      emit({ kind: "block", method: "CONNECT", host, port, reason });
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    };
    if (live >= maxConcurrent) return kill("too_many_connections");
    const decision = await pin(host, port);
    if ("block" in decision) {
      emit({ kind: "block", method: "CONNECT", host, port, reason: decision.block, addressClass: decision.cls });
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    emit({ kind: "allow", method: "CONNECT", host, port, reason: "ok" });
    live++;
    track(clientSocket);
    const upstream = net.connect(port, decision.ip, () => {
      track(upstream);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    const killer = setTimeout(() => upstream.destroy(new Error("egress timeout")), maxMs);
    const cleanup = () => {
      clearTimeout(killer);
      live = Math.max(0, live - 1);
      upstream.destroy();
      clientSocket.destroy();
    };
    upstream.on("error", cleanup);
    upstream.on("close", cleanup);
    clientSocket.on("error", cleanup);
    clientSocket.on("close", cleanup);
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    // <-loopback> disables Chromium's implicit localhost bypass so EVEN loopback destinations are proxied
    // (and thus guard-checked). Production evidence URLs are public, so this only matters to tests.
    chromiumArgs: ["--proxy-bypass-list=<-loopback>"],
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy(); // force upstream + client sockets down so no fixture hangs on close
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}
