# Guarded browser egress boundary (Gate C item 4)

Sage drives a real headless Chromium over attacker-controlled product URLs in two places —
the rendered-evidence capture (`src/lib/deputy/evidence-render.ts`) and the product Field
Test (`src/lib/launch/field-test.ts`). Both are SSRF surfaces: the page's JavaScript runs in
our context and can try to reach internal services (cloud metadata at `169.254.169.254`, a
database, an internal admin panel). This document is the threat model and the architecture
that bounds it.

## 1. The network sequence for each request type

Every one of these is a request Chromium originates. Before Gate C each went straight from
Chromium to the network (Chromium did its own DNS and opened its own sockets); a page-level
Playwright route handler tried to guard them but could be bypassed (a server-side 3xx was
followed without re-firing the handler — the redirect SSRF found and fixed in Gate B).

| Request | How it reaches the network |
| --- | --- |
| top-level navigation | Chromium main-frame request |
| redirects (3xx) | Chromium auto-follows; each hop is a fresh request |
| scripts / images / CSS / fetch / XHR | Chromium subresource requests |
| WebSocket (`ws://` / `wss://`) | HTTP Upgrade handshake (`ws`) or CONNECT (`wss`) |
| EventSource / beacons | Chromium GET / POST subrequests |
| workers / service workers | Chromium fetches the worker script + its own fetches |
| downloads | Chromium request; response streamed to disk |
| popups / new tabs (`window.open`) | a new page → its own navigation |

## 2. The invariant

> **No request originating from an untrusted browser context may reach the network without
> passing through ONE authoritative egress guard that resolves, validates, and pins its
> destination.**

A Node preflight (`resolvesPublic` on the entry URL) followed by Chromium doing its own
networking does NOT satisfy this: it has a TOCTOU / DNS-rebinding window (validation resolves
public, Chromium re-resolves private) and it does not see redirects, subresources, or
WebSockets. So the guard has to sit on the wire, not before it.

## 3. The architecture: a guarded local forward/CONNECT proxy

`src/lib/net/egress-proxy.ts` is a local HTTP proxy bound to `127.0.0.1:<random>`. Chromium
is launched with `proxy: { server }` **and** `--proxy-bypass-list=<-loopback>` (which disables
Chromium's implicit localhost bypass), so **every** request above — nav, redirect hop,
subresource, WebSocket, worker, beacon — exits through it. The browser never does its own DNS
or opens its own socket.

For each connection the proxy:

1. parses the destination host + port from the request line (HTTP) or the `CONNECT` target;
2. refuses any scheme that is not http/https and any port not in the approved set (`{80, 443}`);
3. refuses state-changing methods over plain HTTP (`GET`/`HEAD` only; over HTTPS the method is
   inside TLS and unreadable, so the destination guard is the operative defence there);
4. **resolves the host itself** — an IP literal (any encoding `ipaddr.js` canonicalises,
   including hex/integer/octal and IPv4-mapped IPv6) is classified directly; a hostname is
   resolved via DNS and **every** returned address must pass;
5. **validates**: an address is allowed only if it is plain global unicast. Loopback, private
   (RFC1918), CGNAT, link-local (incl. `169.254.169.254`), multicast, broadcast, unspecified,
   reserved/doc/benchmark, IPv6 ULA, and every IPv6 transition range that can embed a private
   IPv4 (6to4, NAT64, Teredo) are refused. A hostname whose records are a **mix** of public and
   private is refused whole (mixed-record defence);
6. **pins** the single validated IP and connects to exactly that address (preserving the
   hostname for the `Host` header / TLS SNI). Because resolution and connection are one step in
   the proxy and the browser never re-resolves, the **TOCTOU / DNS-rebinding window is closed**;
7. bounds bytes, wall-clock, and concurrency, and **fails closed** on any parse/resolution/
   validation error (empty 403/502 — a refusal never injects capturable content).

Each redirect hop is a brand-new proxy connection, so a `public → public → private` chain is
validated at every hop and refused at the private one.

### Why `ipaddr.js`

IP classification (especially IPv6 and IPv4-mapped/transition ranges) is easy to get subtly
wrong by hand. `ipaddr.js` (1.9.x, dependency-free, widely used — it backs `proxy-addr` /
Express's trust-proxy) does the parsing and range table; `src/lib/net/ip-classify.ts` wraps it
with an **allow-only-`unicast`** policy plus an explicit deny for the one benchmark range it
reports as unicast (198.18/15), and fails closed on any parse error. Maintenance/security note:
it is now a declared direct dependency (pinned `^1.9.1`); because we allow only `unicast`, a
future range-table change could only ever make an address MORE restricted here, never less.

## 4. What is proven, and where

- `src/lib/net/ip-classify.test.ts` — the classifier across the full attack set (v4/v6,
  mapped, transition ranges, metadata, hex/integer/octal literals).
- `src/lib/net/egress-proxy.test.ts` — the proxy directly (no browser): private literal,
  metadata, weird encodings, mapped-loopback, hostname→loopback, mixed records, DNS-rebinding
  (resolves once + pins), non-approved port, state-changing method, non-http scheme, CONNECT to
  private, and a positive allowlisted-fixture forward. Every attack asserts the internal fixture
  server receives **zero** requests.
- `src/lib/deputy/evidence-render.browser.test.ts` — a REAL browser launched through the proxy:
  private-IP subresource, redirect-to-private, redirect chain, DNS-rebinding, WebSocket-to-
  internal, popup, download, plus the renderer hardening (delayed DOM, text cap, ephemeral
  storage, no SW persistence, no hang, reset-safe, no process leak). Every egress attack asserts
  internal hits = 0.
- The Field Test path uses the identical proxy wiring; its opt-in integration test
  (`FIELD_TEST_ENABLED=1`) runs a real browser through the proxy.

## 5. Residual limitations (honest)

- **HTTPS method filtering is impossible at a CONNECT proxy** — the method is inside TLS. The
  destination guard (public-only) is the operative SSRF defence over HTTPS; plain-HTTP method
  filtering is enforced.
- **WebSocket / EventSource to a *public* host may not function through the simple proxy** (it
  does not implement Upgrade forwarding for allowed destinations). This is a functional gap, not
  a safety gap — the destination is still validated, and internal destinations are refused.
- The renderer stays **off**; rendered shadow mode is **also prohibited** for untrusted URLs
  until this boundary is reviewed. No claim is made that the browser is production-safe beyond
  what these tests prove.
