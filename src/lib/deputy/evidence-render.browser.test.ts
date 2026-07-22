import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execSync } from "node:child_process";
import { renderEvidence, MAX_TEXT_CHARS } from "./evidence-render";

/**
 * REAL browser-backed renderer security tests (Gate B item 4). Drives the ACTUAL renderEvidence against a
 * real headless chromium and two internal loopback fixture servers:
 *   · `evidence` — the submitter-controlled page, allowed via a TEST-ONLY origin bypass (not reachable in
 *     production; the production requestGuard is untouched).
 *   · `internal` — a private service that must NEVER be reachable from the adversarial page; its hit
 *     counter is the proof. Its origin is NOT bypassed, so the real guard blocks every attempt to reach it.
 *
 * Skipped unless RENDER_BROWSER_TEST=1 (needs a chromium browser). RENDERED_EVIDENCE_MODE=enforce stays
 * prohibited — these call renderEvidence directly and never arm the payout-facing rollout.
 */
const LIVE = process.env.RENDER_BROWSER_TEST === "1";

interface Fixture {
  origin: string;
  url: (p?: string) => string;
  hits: () => number;
  reset: () => void;
  setHandler: (fn: http.RequestListener) => void;
  close: () => Promise<void>;
}

async function startFixture(initial: http.RequestListener): Promise<Fixture> {
  let handler = initial;
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: (p = "/") => origin + p,
    hits: () => hits,
    reset: () => { hits = 0; },
    setHandler: (fn) => { handler = fn; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const html = (body: string): http.RequestListener => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body>${body}</body></html>`);
};

/** Count live playwright browser processes (launched from the ms-playwright cache). */
function browserProcs(): number {
  try {
    return Number(execSync("pgrep -fc 'ms-playwright' || echo 0").toString().trim()) || 0;
  } catch {
    return 0;
  }
}

let evidence: Fixture;
let internal: Fixture;
let allow: ReadonlySet<string>;
let baselineProcs = 0;

describe.runIf(LIVE)("evidence renderer — real browser security", () => {
  beforeAll(async () => {
    evidence = await startFixture(html("<h1>evidence</h1>"));
    internal = await startFixture((_req, res) => { res.writeHead(200); res.end("INTERNAL SECRET DATA"); });
    allow = new Set([evidence.origin]); // ONLY the evidence origin is bypassed; internal stays guarded
    baselineProcs = browserProcs();
    console.log(`[browser-procs] baseline (before any render) = ${baselineProcs}`);
  }, 60_000);

  afterAll(async () => {
    await evidence?.close();
    await internal?.close();
    // teardown lag can leave a process briefly; poll down to baseline.
    let after = browserProcs();
    for (let i = 0; i < 20 && after > baselineProcs; i++) {
      await new Promise((r) => setTimeout(r, 250));
      after = browserProcs();
    }
    console.log(`[browser-procs] final = ${after} (baseline ${baselineProcs})`);
    expect(after, "no leaked browser processes after the suite").toBeLessThanOrEqual(baselineProcs);
  });

  it("a clean page renders its visible text (baseline)", async () => {
    evidence.setHandler(html("<h1>Hello Evidence</h1><p>Visible tester text.</p>"));
    const r = await renderEvidence(evidence.url("/simple"), { allowOrigins: allow });
    expect(r.outcome).toBe("ok");
    expect(r.text).toContain("Hello Evidence");
    expect(browserProcs()).toBeLessThanOrEqual(baselineProcs); // browser closed after success
  }, 40_000);

  it("private-IP subresource is BLOCKED (internal service never hit)", async () => {
    internal.reset();
    evidence.setHandler(html(`PARENT PAGE<img src="${internal.origin}/pixel"><script>fetch("${internal.origin}/data").catch(()=>{});new Image().src="${internal.origin}/beacon";</script>`));
    const r = await renderEvidence(evidence.url("/subresource"), { allowOrigins: allow });
    expect(r.text).toContain("PARENT PAGE"); // the page still renders...
    expect(internal.hits(), "the guard must abort every subresource to the internal origin").toBe(0); // ...but never reaches internal
  }, 40_000);

  it("redirect to a private origin is BLOCKED (internal never hit)", async () => {
    internal.reset();
    evidence.setHandler((_req, res) => {
      res.writeHead(302, { location: `${internal.origin}/secret` });
      res.end();
    });
    const r = await renderEvidence(evidence.url("/redirect"), { allowOrigins: allow });
    expect(internal.hits(), "the guard must block a redirect into the internal origin").toBe(0);
    expect(r.text).toBeNull(); // nothing captured — the redirect target was refused
  }, 40_000);

  it("a popup / second tab is CLOSED (no OAuth dance, no leak)", async () => {
    evidence.setHandler(html(`PARENT<script>window.open("${evidence.origin}/other","_blank");window.open("about:blank");</script>`));
    const r = await renderEvidence(evidence.url("/popup"), { allowOrigins: allow });
    expect(r.text).toContain("PARENT"); // the parent renders; popups were closed, not followed
  }, 40_000);

  it("a download is REFUSED (no file, page not hijacked)", async () => {
    evidence.setHandler((req, res) => {
      if (req.url === "/file") {
        res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=eve.bin" });
        return void res.end("BINARY");
      }
      html(`DOWNLOAD PAGE<script>const a=document.createElement("a");a.href="/file";a.download="eve.bin";document.body.appendChild(a);a.click();</script>`)(req, res);
    });
    const r = await renderEvidence(evidence.url("/download"), { allowOrigins: allow });
    expect(r.text).toContain("DOWNLOAD PAGE"); // render survived; the download was cancelled by the context
  }, 40_000);

  it("delayed DOM (injected < settle window) IS captured", async () => {
    evidence.setHandler(html(`<div id="x">loading</div><script>setTimeout(()=>{document.getElementById("x").textContent="DELAYED CONTENT SHOWN"},1000)</script>`));
    const r = await renderEvidence(evidence.url("/delayed"), { allowOrigins: allow });
    expect(r.text).toContain("DELAYED CONTENT SHOWN");
  }, 40_000);

  it("oversized innerText is CAPPED at MAX_TEXT_CHARS", async () => {
    const huge = "A".repeat(400_000);
    evidence.setHandler(html(`<div>${huge}</div>`));
    const r = await renderEvidence(evidence.url("/huge"), { allowOrigins: allow });
    expect(r.text).not.toBeNull();
    expect(r.text!.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  }, 40_000);

  it("cookies + localStorage do NOT survive across renders (ephemeral context)", async () => {
    // The page reports whether it saw prior state, THEN writes it. A persistent context would read
    // "PERSISTED" on the second render; an ephemeral one reads "FRESH" every time.
    evidence.setHandler(html(`<div id="o"></div><script>
      const seen = (localStorage.getItem("k")||document.cookie.includes("k=")) ? "PERSISTED" : "FRESH";
      try{localStorage.setItem("k","1")}catch(e){}; document.cookie="k=1";
      document.getElementById("o").textContent = seen;
    </script>`));
    const a = await renderEvidence(evidence.url("/persist"), { allowOrigins: allow });
    const b = await renderEvidence(evidence.url("/persist"), { allowOrigins: allow });
    expect(a.text).toContain("FRESH");
    expect(b.text, "a second render must not see the first render's cookies/localStorage").toContain("FRESH");
  }, 60_000);

  it("a service worker does NOT persist across renders (no cross-render control)", async () => {
    evidence.setHandler((req, res) => {
      if (req.url === "/sw.js") {
        res.writeHead(200, { "content-type": "application/javascript" });
        return void res.end("self.addEventListener('fetch',()=>{});");
      }
      html(`<div id="o"></div><script>
        (async()=>{ try{ await navigator.serviceWorker.register("/sw.js"); }catch(e){}
          document.getElementById("o").textContent = navigator.serviceWorker.controller ? "CONTROLLED" : "NOCONTROL"; })();
      </script>`)(req, res);
    });
    const a = await renderEvidence(evidence.url("/sw"), { allowOrigins: allow });
    const b = await renderEvidence(evidence.url("/sw"), { allowOrigins: allow });
    expect(a.text).toContain("NOCONTROL");
    expect(b.text, "a service worker from render A must not control render B").toContain("NOCONTROL");
  }, 60_000);

  it("an endless connection does NOT hang — returns within the cap", async () => {
    evidence.setHandler(() => { /* never respond: hold the socket open */ });
    const t0 = Date.now();
    const r = await renderEvidence(evidence.url("/hang"), { allowOrigins: allow });
    const elapsed = Date.now() - t0;
    expect(r.text).toBeNull();
    expect(["timeout", "nav_failed"]).toContain(r.outcome);
    expect(elapsed, "must return within the total cap, not hang").toBeLessThan(35_000);
    expect(browserProcs()).toBeLessThanOrEqual(baselineProcs); // browser closed after timeout
  }, 45_000);

  it("a connection reset mid-load → returns null, browser closed (no leak, no crash)", async () => {
    evidence.setHandler((req) => { req.socket.destroy(); });
    const r = await renderEvidence(evidence.url("/reset"), { allowOrigins: allow });
    expect(r.text).toBeNull();
    expect(["nav_failed", "error", "timeout"]).toContain(r.outcome);
    expect(browserProcs()).toBeLessThanOrEqual(baselineProcs); // browser closed after exception
  }, 45_000);

  it("a NON-bypassed loopback origin is refused (the guard is not globally weakened)", async () => {
    // internal.origin is loopback and NOT in allowOrigins → the production guard blocks it at the entry,
    // proving the test bypass is per-origin, not a blanket loopback allowance.
    internal.reset();
    const r = await renderEvidence(internal.url("/direct"), { allowOrigins: allow });
    expect(r.outcome).toBe("guard_block");
    expect(internal.hits()).toBe(0);
  }, 20_000);
});
