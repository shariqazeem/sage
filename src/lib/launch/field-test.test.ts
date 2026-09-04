import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  requestGuard,
  visibleTextLen,
  computeJsOnly,
  classifyMode,
  isInteractiveApp,
  fingerprintDelta,
  buildFieldTestSummary,
  buildInteractiveSummary,
  viewTruncations,
  docCandidates,
  interactiveClassification,
  canvasStrokes,
  explorationCounts,
  fieldTestForMap,
  runFieldTest,
  turnedAwayLimitation,
  classifyWallKind,
  wallNoteFor,
  type FieldTestCapture,
  type ProductSignals,
} from "./field-test";
import type { FieldTestSummary } from "./schemas";
import type { FieldTestState } from "./schemas";

/* ───────────────────────────── interception guard ───────────────────────── */

describe("requestGuard (interception guard)", () => {
  it("blocks non-http(s) schemes", () => {
    for (const url of ["data:text/html,<h1>x", "javascript:alert(1)", "file:///etc/passwd", "blob:https://x/y", "ws://example.com"]) {
      const g = requestGuard(url);
      expect(g.allow, url).toBe(false);
    }
  });

  it("blocks private / loopback / metadata hosts (via the frozen SSRF validator)", () => {
    for (const url of ["https://localhost/x", "https://127.0.0.1/", "https://169.254.169.254/latest", "https://10.0.0.1/", "http://example.com/"]) {
      // http://example.com is blocked too — validateEvidenceUrl requires https.
      expect(requestGuard(url).allow, url).toBe(false);
    }
  });

  it("allows a public https url", () => {
    expect(requestGuard("https://example.com/pricing").allow).toBe(true);
    expect(requestGuard("https://sub.example.co.uk/a/b?c=1").allow).toBe(true);
  });

  it("blocks an unparseable url", () => {
    expect(requestGuard("not a url").allow).toBe(false);
  });
});

/* ─────────────────────────────── pure helpers ────────────────────────────── */

describe("visibleTextLen", () => {
  it("strips scripts, styles, and tags", () => {
    const html = `<html><head><style>.a{color:red}</style></head><body><script>var x=123456</script><h1>Hi   there</h1></body></html>`;
    expect(visibleTextLen(html)).toBe("Hi there".length);
  });
  it("is 0 for an empty/tag-only doc", () => {
    expect(visibleTextLen("<html><body></body></html>")).toBe(0);
  });
});

describe("computeJsOnly", () => {
  it("flags a page whose rendered text dwarfs its server HTML", () => {
    expect(computeJsOnly(20, 620)).toBe(true); // SPA shell → hydrated
    expect(computeJsOnly(0, 500)).toBe(true);
  });
  it("does NOT flag a content-rich server page", () => {
    expect(computeJsOnly(5000, 6000)).toBe(false); // server already had the text
    expect(computeJsOnly(0, 100)).toBe(false); // too little content either way
    expect(computeJsOnly(300, 700)).toBe(false); // 700 <= 300*2+300
  });
});

/* ──────────────────────────── summary builder ────────────────────────────── */

function capture(over: Partial<FieldTestCapture> = {}): FieldTestCapture {
  return {
    url: "https://example.com/",
    title: "Example",
    h1: "Welcome",
    ctas: [],
    forms: [],
    consoleErrors: [],
    failedRequests: [],
    rawHtmlTextLen: 100,
    renderedTextLen: 120,
    screenshot: "/field-tests/abc/0.png",
    ...over,
  };
}

describe("buildFieldTestSummary", () => {
  it("caps CTAs at 10, filters non-broken requests, computes jsOnly, and reports ran", () => {
    const summary = buildFieldTestSummary({
      startUrl: "https://example.com/",
      durationMs: 1234,
      limitation: null,
      captures: [
        capture({
          ctas: Array.from({ length: 15 }, (_, i) => `CTA ${i}`),
          failedRequests: [
            { url: "https://example.com/ok.png", status: 200 }, // 2xx → filtered
            { url: "https://example.com/missing.png", status: 404 }, // broken → kept
            { url: "https://example.com/aborted", status: 0 }, // guard-aborted → filtered (not the product's fault)
            { url: "https://example.com/boom", status: 500 }, // broken → kept
          ],
          rawHtmlTextLen: 20,
          renderedTextLen: 900, // → jsOnly
        }),
      ],
    });
    expect(summary.ran).toBe(true);
    expect(summary.pages).toHaveLength(1);
    expect(summary.pages[0].ctas).toHaveLength(10);
    expect(summary.pages[0].brokenRequests).toEqual([
      { url: "https://example.com/missing.png", status: 404 },
      { url: "https://example.com/boom", status: 500 },
    ]);
    expect(summary.pages[0].jsOnly).toBe(true);
    expect(summary.durationMs).toBe(1234);
  });

  it("caps pages at 6 and reports ran=false for no captures", () => {
    const many = buildFieldTestSummary({
      startUrl: "https://example.com/",
      durationMs: 1,
      limitation: null,
      captures: Array.from({ length: 9 }, () => capture()),
    });
    expect(many.pages).toHaveLength(6);

    const none = buildFieldTestSummary({ startUrl: "https://example.com/", durationMs: 1, limitation: "x", captures: [] });
    expect(none.ran).toBe(false);
    expect(none.pages).toEqual([]);
  });
});

describe("fieldTestForMap (static)", () => {
  it("projects only the brain-relevant fields (no screenshots, no forms) and caps lists", () => {
    const summary = buildFieldTestSummary({
      startUrl: "https://example.com/",
      durationMs: 1,
      limitation: null,
      captures: [
        capture({
          title: "Pricing",
          url: "https://example.com/pricing",
          ctas: Array.from({ length: 9 }, (_, i) => `c${i}`),
          consoleErrors: Array.from({ length: 8 }, (_, i) => `err ${i}`),
          failedRequests: Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}`, status: 500 })),
        }),
      ],
    });
    const forMap = fieldTestForMap(summary);
    expect(forMap.mode).toBe("static");
    if (forMap.mode !== "static") throw new Error("expected static");
    expect(forMap.pages).toHaveLength(1);
    const p = forMap.pages[0];
    expect(p).toStrictEqual({
      url: "https://example.com/pricing",
      title: "Pricing",
      ctas: p.ctas,
      consoleErrors: p.consoleErrors,
      brokenRequests: p.brokenRequests,
      jsOnly: false,
    });
    expect(p.ctas.length).toBeLessThanOrEqual(8);
    expect(p.consoleErrors).toHaveLength(5);
    expect(p.brokenRequests).toHaveLength(5);
    // the projection must not leak a screenshot path or forms to the LLM.
    expect(JSON.stringify(forMap)).not.toContain("/field-tests/");
    expect(JSON.stringify(forMap)).not.toContain("\"forms\"");
  });
});

/* ─────────────── interactive-mode helpers (the P12 state machine) ─────────── */

function signals(over: Partial<ProductSignals> = {}): ProductSignals {
  return {
    hasCanvas: false,
    canvasArea: 0,
    webgl: false,
    keyListeners: false,
    gamepad: false,
    spaRouting: false,
    selfAnimates: false,
    nodeCount: 200,
    renderedTextLen: 2000,
    rawHtmlTextLen: 1500,
    hasServiceWorker: false,
    ...over,
  };
}

function state(trigger: string, over: Partial<FieldTestState> = {}): FieldTestState {
  return {
    trigger,
    screenshot: `/api/field-tests/x/${trigger}`,
    visibleTextExcerpt: "",
    notableElements: [],
    pixelDeltaPct: 20,
    url: "https://game.example/",
    ...over,
  };
}

/**
 * A RUN THAT WAS TURNED AWAY MUST NOT LOOK LIKE A CONTENT SITE.
 *
 * "static" arrives two ways — a real classification of a real content site, and a fallback when the
 * browser never got a usable look — and both recorded `limitation: null` whenever the HTML crawl
 * found any page at all. Measured: allbirds.com and web.telegram.org each flipped between
 * interactive and static in BOTH directions on 2026-08-06, allbirds seeing 13 browser states in one
 * run and 0 the next hour on the same URL, with nothing in the record to tell the two apart.
 */
describe("turnedAwayLimitation", () => {
  it("says so when the browser could not open the product at all", () => {
    const l = turnedAwayLimitation("net::ERR_CONNECTION_RESET at https://example.com", false);
    expect(l).toContain("could not open this product in a browser");
    expect(l).toContain("ERR_CONNECTION_RESET");
  });

  it("says so when a bot challenge stood in the way", () => {
    expect(turnedAwayLimitation(null, true)).toContain("bot challenge");
  });

  it("stays silent when static was a real classification", () => {
    // a genuine content site must not be labelled as blocked
    expect(turnedAwayLimitation(null, false)).toBeNull();
  });

  it("prefers the blocked door over the challenge, as the more specific truth", () => {
    expect(turnedAwayLimitation("Timeout 30000ms exceeded", true)).toContain("could not open");
  });

  it("bounds the quoted browser error so a long stack cannot run away with the copy", () => {
    const l = turnedAwayLimitation("x".repeat(500), false);
    expect(l!.length).toBeLessThan(250);
  });

  it("never diagnoses the product, only what Sage did", () => {
    // "your site blocks bots" is a guess; "Sage could not open it" is a fact.
    for (const l of [turnedAwayLimitation("boom", false), turnedAwayLimitation(null, true)]) {
      expect(l!.toLowerCase()).not.toMatch(/your (site|product) (blocks|is blocking)/);
      expect(l!.startsWith("Sage ")).toBe(true);
    }
  });
});

describe("classifyMode", () => {
  it("interactive: a big WebGL canvas with thin text (a game/experience)", () => {
    expect(classifyMode(signals({ hasCanvas: true, canvasArea: 640 * 480, webgl: true, renderedTextLen: 30 }))).toBe("interactive");
  });
  it("interactive: a big canvas that listens for keydown", () => {
    expect(classifyMode(signals({ hasCanvas: true, canvasArea: 800 * 600, keyListeners: true, renderedTextLen: 900 }))).toBe("interactive");
  });
  it("interactive: a thin SPA shell wrapped around a big canvas", () => {
    expect(classifyMode(signals({ hasCanvas: true, canvasArea: 700 * 500, spaRouting: true, renderedTextLen: 120 }))).toBe("interactive");
  });
  it("interactive: a thin, self-animating DOM experience with NO canvas (the yara.garden shape)", () => {
    expect(classifyMode(signals({ hasCanvas: false, canvasArea: 0, renderedTextLen: 220, selfAnimates: true }))).toBe("interactive");
  });
  it("static: a content site with lots of text and no big canvas", () => {
    expect(classifyMode(signals({ renderedTextLen: 5000 }))).toBe("static");
  });
  it("static: a small decorative canvas on a text-rich page is NOT a game", () => {
    expect(classifyMode(signals({ hasCanvas: true, canvasArea: 64 * 64, renderedTextLen: 3000 }))).toBe("static");
  });
  it("static: a thin page that does NOT self-animate and takes no input is just a thin page", () => {
    expect(classifyMode(signals({ renderedTextLen: 220, selfAnimates: false }))).toBe("static");
  });
  it("static: self-animation on a TEXT-RICH page (a carousel) stays static — it's readable content", () => {
    expect(classifyMode(signals({ renderedTextLen: 4000, selfAnimates: true }))).toBe("static");
  });
});

describe("isInteractiveApp (the jsOnly honesty fix)", () => {
  it("true: near-zero text in raw AND rendered, with a big canvas", () => {
    expect(isInteractiveApp(50, 30, true)).toBe(true);
  });
  it("false: no canvas (a plain SPA shell — that's jsOnly, not an app)", () => {
    expect(isInteractiveApp(50, 30, false)).toBe(false);
  });
  it("false: it actually rendered real text", () => {
    expect(isInteractiveApp(50, 2000, true)).toBe(false);
  });
});

describe("fingerprintDelta", () => {
  it("100 vs a null prior (the first state is always kept)", () => {
    expect(fingerprintDelta(null, { textLen: 10, nodeCount: 5, canvasSample: null })).toBe(100);
  });
  it("0 for an identical state", () => {
    const fp = { textLen: 100, nodeCount: 50, canvasSample: [1, 2, 3, 4] };
    expect(fingerprintDelta(fp, { ...fp, canvasSample: [...fp.canvasSample] })).toBe(0);
  });
  it("detects a canvas-only change when the DOM is byte-identical", () => {
    const a = { textLen: 100, nodeCount: 50, canvasSample: [10, 10, 10, 10] };
    const b = { textLen: 100, nodeCount: 50, canvasSample: [220, 220, 220, 220] };
    expect(fingerprintDelta(a, b)).toBeGreaterThan(50);
  });
});

describe("buildInteractiveSummary", () => {
  it("marks mode interactive, keeps the state log, and sets an honest classification", () => {
    const s = buildInteractiveSummary({
      startUrl: "https://game.example/",
      states: [state("initial load"), state("waited out loading"), state("clicked 'Start'")],
      durationMs: 5,
      limitation: null,
    });
    expect(s.mode).toBe("interactive");
    expect(s.ran).toBe(true);
    expect(s.pages).toEqual([]);
    expect(s.states).toHaveLength(3);
    expect(s.classification).toBe("Interactive app detected · 3 states, 0 elements explored");
  });
  it("ran=false and no classification when nothing was observed", () => {
    const s = buildInteractiveSummary({ startUrl: "x", states: [], durationMs: 1, limitation: "loading never resolved" });
    expect(s.ran).toBe(false);
    expect(s.classification).toBeNull();
  });
});

describe("interactiveClassification (P21 — states AND distinct elements)", () => {
  it("counts distinct notable-element texts across states, case-insensitively", () => {
    const states = [
      state("initial load", { notableElements: [{ tag: "button", text: "Rectangle", role: "button" }] }),
      state("drew on the canvas", {
        notableElements: [
          { tag: "label", text: "Stroke", role: "" },
          { tag: "label", text: "Background", role: "" },
          { tag: "button", text: "rectangle", role: "button" }, // dup of "Rectangle" (case-insensitive)
        ],
      }),
    ];
    // distinct: rectangle, stroke, background = 3
    expect(interactiveClassification(states)).toBe("Interactive app detected · 2 states, 3 elements explored");
  });
  it("singularizes one element", () => {
    expect(interactiveClassification([state("s", { notableElements: [{ tag: "b", text: "Only", role: "" }] })]))
      .toBe("Interactive app detected · 1 states, 1 element explored");
  });
});

describe("explorationCounts (P23 — Sage's exploration breadth for the board)", () => {
  const base = { ran: true, startUrl: "https://x/", classification: null, limitation: null, durationMs: 1, pages: [], states: [] };
  it("interactive: screens = states, elements = distinct notable-element texts", () => {
    const summary = {
      ...base, mode: "interactive",
      states: [
        state("initial", { notableElements: [{ tag: "b", text: "Rectangle", role: "" }] }),
        state("drew", { notableElements: [{ tag: "l", text: "Stroke", role: "" }, { tag: "l", text: "rectangle", role: "" }] }),
      ],
    } as unknown as FieldTestSummary;
    // distinct: rectangle, stroke = 2 (case-insensitive dedup); screens = 2
    expect(explorationCounts(summary)).toEqual({ screens: 2, elements: 2 });
  });
  it("static: screens = pages, elements = distinct CTAs", () => {
    const summary = {
      ...base, mode: "static",
      pages: [
        { url: "a", title: "", h1: "", ctas: ["Sign up", "Pricing"], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null },
        { url: "b", title: "", h1: "", ctas: ["pricing", "Docs"], forms: [], consoleErrors: [], brokenRequests: [], jsOnly: false, screenshot: null },
      ],
    } as unknown as FieldTestSummary;
    // distinct: sign up, pricing, docs = 3; screens = 2
    expect(explorationCounts(summary)).toEqual({ screens: 2, elements: 3 });
  });
  it("returns 0/0 when the field test didn't run", () => {
    expect(explorationCounts(null)).toEqual({ screens: 0, elements: 0 });
    expect(explorationCounts({ ...base, ran: false } as unknown as FieldTestSummary)).toEqual({ screens: 0, elements: 0 });
  });
});

describe("canvasStrokes (P21 — safe drag gestures inside a canvas)", () => {
  const box = { x: 100, y: 50, width: 800, height: 600 };
  it("plans DRAW_STROKES gestures by default, all confined to the central region of the box", () => {
    const strokes = canvasStrokes(box);
    expect(strokes.length).toBe(3);
    const innerL = box.x + box.width * 0.2, innerR = box.x + box.width * 0.8;
    const innerT = box.y + box.height * 0.2, innerB = box.y + box.height * 0.8;
    for (const s of strokes) {
      for (const [px, py] of [s.from, s.to]) {
        expect(px).toBeGreaterThanOrEqual(innerL);
        expect(px).toBeLessThanOrEqual(innerR);
        expect(py).toBeGreaterThanOrEqual(innerT);
        expect(py).toBeLessThanOrEqual(innerB);
      }
    }
  });
  it("is deterministic — the same box yields identical gestures", () => {
    expect(canvasStrokes(box)).toEqual(canvasStrokes(box));
  });
  it("returns nothing for a zero-area box or a non-positive count", () => {
    expect(canvasStrokes({ x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(canvasStrokes(box, 0)).toEqual([]);
  });
});

describe("fieldTestForMap (interactive)", () => {
  it("surfaces the observed state log to the brain, no screenshots leaked", () => {
    const summary = buildInteractiveSummary({
      startUrl: "https://game.example/",
      states: [
        state("initial load", { visibleTextExcerpt: "Loading the world…" }),
        state("clicked 'Start'", { visibleTextExcerpt: "Pick your character", notableElements: [{ tag: "button", text: "Warrior", role: "button" }] }),
      ],
      durationMs: 3,
      limitation: null,
    });
    const forMap = fieldTestForMap(summary);
    expect(forMap.mode).toBe("interactive");
    if (forMap.mode !== "interactive") throw new Error("expected interactive");
    expect(forMap.states).toHaveLength(2);
    expect(forMap.states[1].trigger).toBe("clicked 'Start'");
    expect(forMap.states[1].visibleTextExcerpt).toContain("Pick your character");
    expect(forMap.classification).toContain("Interactive app detected");
    // the projection must not leak a screenshot path to the LLM.
    expect(JSON.stringify(forMap)).not.toContain("/api/field-tests/");
  });
});

/* ──────────── flag-gated integration test (real chromium, local fixture) ──── */

const FIXTURE = `<!doctype html><html><head><title>Fixture Product</title></head>
<body>
  <h1>Fixture Product</h1>
  <button class="btn">Sign up free</button>
  <img src="/definitely-missing.png" alt="broken"/>
  <script>
    console.error("synthetic console error for the field test");
    var d = document.createElement("div");
    d.textContent = "This paragraph is injected by JavaScript after load, ".repeat(20);
    document.body.appendChild(d);
  </script>
</body></html>`;

const RUN_INTEGRATION = process.env.FIELD_TEST_ENABLED === "1";

/** A product whose FRONT DOOR is a login wall, with its own documentation one link away. */
const WALL_FIXTURE = `<!doctype html><html><head><title>Vaultly — Sign in</title></head><body>
  <h1>Sign in to continue</h1>
  <p>Vaultly is a portfolio tracker for on-chain positions. Sign in to continue to your dashboard.</p>
  <form>
    <label>Email <input type="email" name="email"></label>
    <label>Password <input type="password" name="password"></label>
  </form>
  <nav><a href="/docs">Documentation</a> <a href="/pricing">Pricing</a></nav>
</body></html>`;

const WALL_DOCS = `<!doctype html><html><head><title>Vaultly Docs</title></head><body>
  <h1>What you see after signing in</h1>
  <p>${"Once signed in, a connected user lands on the Portfolio view, which lists every tracked position with its current value and a 24-hour change column. The Positions tab groups holdings by chain. ".repeat(4)}</p>
</body></html>`;

(RUN_INTEGRATION ? describe : describe.skip)("runFieldTest integration (local fixture)", () => {
  it("browses a local page, screenshots it, and captures JS-only + broken-request findings", async () => {
    const server: Server = createServer((req, res) => {
      if (req.url === "/" || req.url === "") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(FIXTURE);
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const startUrl = `http://127.0.0.1:${port}/`;
    const publicDir = mkdtempSync(join(tmpdir(), "sage-ft-"));

    try {
      const summary = await runFieldTest(
        { inspectionId: "itest", startUrl, host: `127.0.0.1:${port}`, candidateLinks: [] },
        // Inject permissive guards + allowlist the loopback fixture at the egress proxy (prod allowlists
        // nothing, so loopback is always refused there).
        {
          isPublicHost: async () => true,
          allowUrl: () => ({ allow: true, reason: "test" }),
          publicDir,
          egressAllowLoopback: new Set([`127.0.0.1:${port}`]),
          egressAllowedPorts: new Set([port]),
        },
      );

      if (!summary.ran && /not installed/i.test(summary.limitation ?? "")) {
        console.warn("[field-test.integration] chromium not installed — run `npx playwright install chromium`; skipping deep asserts");
        return;
      }
      expect(summary.ran).toBe(true);
      expect(summary.mode).toBe("static"); // a text page with no big canvas is still crawled exactly as before
      expect(summary.pages.length).toBeGreaterThanOrEqual(1);
      const page = summary.pages[0];
      expect(page.title).toContain("Fixture");
      expect(page.screenshot).toBe("/api/field-tests/itest/0"); // served via the API route
      expect(existsSync(join(publicDir, "field-tests", "itest", "0.png"))).toBe(true); // written to disk here

      // the injected script both logs an error and grows the DOM well beyond the server HTML.
      expect(page.consoleErrors.join(" ")).toMatch(/synthetic console error/);
      expect(page.jsOnly).toBe(true);
      expect(page.brokenRequests.some((r) => r.status === 404)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});

/* ── flag-gated integration: a client game (loading → start → canvas world) ── */

// A miniature SPA "game": a loading screen for ~700ms, then a Start button, then a
// keyboard-driven canvas world. Exercises the whole state machine — mode detection,
// loading patience, the click ladder, and canvas key nudging — the yara.garden shape.
const GAME_FIXTURE = `<!doctype html><html><head><title>Fixture Game</title></head>
<body>
  <div id="loading">Loading the world</div>
  <div id="menu" style="display:none"><button id="start">Start</button></div>
  <canvas id="game" width="640" height="480" style="display:none"></canvas>
  <script>
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');
    var px = 40;
    function draw(){ ctx.fillStyle = '#123456'; ctx.fillRect(0,0,640,480); ctx.fillStyle = '#ffcc00'; ctx.fillRect(px, 200, 60, 60); }
    window.addEventListener('keydown', function(e){
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { px = (px + 90) % 560; draw(); }
    });
    // an animated loading screen that persists a few seconds — so a real browser sees motion WHILE
    // still loading, and the loading-patience loop genuinely has to wait it out.
    var n = 0;
    var spin = setInterval(function(){ document.getElementById('loading').textContent = 'Loading the world' + '.'.repeat(n++ % 4); }, 300);
    setTimeout(function(){
      clearInterval(spin);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('menu').style.display = 'block';
    }, 3500);
    document.getElementById('start').addEventListener('click', function(){
      document.getElementById('menu').style.display = 'none';
      canvas.style.display = 'block';
      draw();
    });
  </script>
</body></html>`;

/**
 * THE FRONT DOOR IS THE WALL — the shape that could never reach the doc hunt.
 *
 * The hunt first shipped inside the interactive explorer. A product whose entire app sits behind a
 * sign-in classifies `static` with 0 states, never enters the explorer, and so was guaranteed NOT to
 * get docs — while being exactly the web3 shape the hunt exists for. This drives the real browser
 * against a login-walled fixture and asserts the docs come back attached to a STATIC summary.
 */
(RUN_INTEGRATION ? describe : describe.skip)("runFieldTest — a login wall at the entry still gets the docs read", () => {
  it("classifies the wall, reads the linked documentation, and says which wall sent it there", async () => {
    const server: Server = createServer((req, res) => {
      const url = (req.url ?? "").split("?")[0];
      if (url === "/" || url === "") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(WALL_FIXTURE);
      } else if (url === "/docs") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(WALL_DOCS);
      } else if (url === "/documentation") {
        // a HARD 404 with a chatty shell — the clawup trap: 247 chars of nav/footer cleared the old floor
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html><head><title>Vaultly</title></head><body><nav>Home Docs Pricing Sign in</nav><h1>404</h1><p>This page could not be found.</p><footer>Vaultly Inc. Terms Privacy Brand assets Contact Careers Status</footer></body></html>");
      } else if (url === "/guide") {
        // a SOFT 404: HTTP 200 but not-found wording — SPAs do this constantly
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><head><title>Page not found - Vaultly</title></head><body><nav>Home Docs Pricing Sign in</nav><p>Sorry, this page could not be found. It may have moved.</p><footer>Vaultly Inc. Terms Privacy Brand assets Contact Careers Status More links here to pad the shell out past any small character floor for the test.</footer></body></html>");
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const publicDir = mkdtempSync(join(tmpdir(), "sage-ft-wall-"));

    try {
      const summary = await runFieldTest(
        {
          inspectionId: "walltest",
          startUrl: `http://127.0.0.1:${port}/`,
          host: `127.0.0.1:${port}`,
          candidateLinks: [],
        },
        {
          isPublicHost: async () => true,
          allowUrl: () => ({ allow: true, reason: "test" }),
          publicDir,
          egressAllowLoopback: new Set([`127.0.0.1:${port}`]),
          egressAllowedPorts: new Set([port]),
        },
      );

      if (!summary.ran && /not installed/i.test(summary.limitation ?? "")) {
        console.warn("[field-test.wall] chromium not installed — skipping deep asserts");
        return;
      }
      // The whole point: a STATIC run, and it still came back with documentation.
      expect(summary.mode).toBe("static");
      expect(summary.docs?.length ?? 0).toBeGreaterThanOrEqual(1);
      // AND NEVER A 404 DRESSED AS DOCUMENTATION — measured on the first real clawup campaign:
      // three not-found shells were kept as docs and their screenshots led the founder's filmstrip.
      for (const d of summary.docs ?? []) {
        expect(d.url).not.toMatch(/\/(documentation|guide)$/); // the hard-404 and the soft-404
        expect(`${d.title} ${d.excerpt}`).not.toMatch(/could not be found|page not found/i);
      }
      const doc = summary.docs![0];
      expect(doc.soughtBecause).toBe("login required past this point");
      expect(doc.excerpt).toContain("Portfolio view");
      expect(doc.url).toContain("/docs");
      // and the brain actually receives it
      const view = fieldTestForMap(summary);
      expect(JSON.stringify(view)).toContain("Portfolio view");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 180_000);
});

(RUN_INTEGRATION ? describe : describe.skip)("runFieldTest interactive (local game fixture)", () => {
  it("classifies interactive, waits out loading, and captures states PAST the loading screen", async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(GAME_FIXTURE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const startUrl = `http://127.0.0.1:${port}/`;
    const publicDir = mkdtempSync(join(tmpdir(), "sage-ft-game-"));

    try {
      const summary = await runFieldTest(
        { inspectionId: "gtest", startUrl, host: `127.0.0.1:${port}`, candidateLinks: [] },
        {
          isPublicHost: async () => true,
          allowUrl: () => ({ allow: true, reason: "test" }),
          publicDir,
          egressAllowLoopback: new Set([`127.0.0.1:${port}`]),
          egressAllowedPorts: new Set([port]),
        },
      );

      if (!summary.ran && /not installed/i.test(summary.limitation ?? "")) {
        console.warn("[field-test.integration] chromium not installed — skipping game asserts");
        return;
      }
      // 1. it recognized a client app, not a content site.
      expect(summary.mode).toBe("interactive");
      expect(summary.pages).toEqual([]);
      expect(summary.classification).toMatch(/Interactive app detected/);

      // 2. it got PAST the loading screen — the whole point of P12.
      expect(summary.states.length).toBeGreaterThanOrEqual(3);
      const triggers = summary.states.map((s) => s.trigger);
      expect(triggers[0]).toBe("initial load");
      expect(triggers).toContain("waited out loading");
      expect(triggers.some((t) => /clicked "start"/i.test(t))).toBe(true);

      // 3. a state after loading actually differs from the loading screen (real progress).
      const postLoad = summary.states.find((s) => s.trigger === "waited out loading");
      expect(postLoad).toBeTruthy();
      expect(postLoad!.visibleTextExcerpt.toLowerCase()).not.toContain("loading the world");

      // 4. reaching the canvas world produced a real visual change (a non-loading capture with delta).
      const clickState = summary.states.find((s) => /clicked "start"/i.test(s.trigger));
      expect(clickState).toBeTruthy();
      expect(existsSync(join(publicDir, "field-tests", "gtest", "0.png"))).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 90_000);
});

/* ── flag-gated integration: a canvasless, self-animating DOM world (the yara.garden shape) ── */

// No canvas at all: a thin shell whose "critters" text churns on a timer (self-animation) and whose
// named scenes are clickable choices. This is exactly why the canvas-only classifier missed yara.garden.
const WORLD_FIXTURE = `<!doctype html><html><head><title>Fixture World</title></head>
<body>
  <div id="location">a gentle clearing</div>
  <div id="critters">butterflies drift</div>
  <button id="pond">Still Pond</button>
  <button id="grove">Yara's Grove</button>
  <span id="zoom" style="cursor:pointer">+</span>
  <script>
    var frames = ["butterflies drift left", "butterflies drift right", "leaves rustle", "a bird sings"];
    var i = 0;
    setInterval(function(){ document.getElementById("critters").textContent = frames[i++ % frames.length]; }, 800);
    document.getElementById("pond").addEventListener("click", function(){ document.getElementById("location").textContent = "Still Pond — the water mirrors the sky"; });
    document.getElementById("grove").addEventListener("click", function(){ document.getElementById("location").textContent = "Yara's Grove — tall trees hum overhead"; });
  </script>
</body></html>`;

(RUN_INTEGRATION ? describe : describe.skip)("runFieldTest interactive (canvasless self-animating world)", () => {
  it("detects a canvasless experience via self-animation and explores its scenes by clicking", async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(WORLD_FIXTURE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const startUrl = `http://127.0.0.1:${port}/`;
    const publicDir = mkdtempSync(join(tmpdir(), "sage-ft-world-"));

    try {
      const summary = await runFieldTest(
        { inspectionId: "wtest", startUrl, host: `127.0.0.1:${port}`, candidateLinks: [] },
        {
          isPublicHost: async () => true,
          allowUrl: () => ({ allow: true, reason: "test" }),
          publicDir,
          egressAllowLoopback: new Set([`127.0.0.1:${port}`]),
          egressAllowedPorts: new Set([port]),
        },
      );

      if (!summary.ran && /not installed/i.test(summary.limitation ?? "")) {
        console.warn("[field-test.integration] chromium not installed — skipping world asserts");
        return;
      }
      // classified interactive with NO canvas — purely from self-animation + thin text.
      expect(summary.mode).toBe("interactive");
      expect(summary.classification).toMatch(/Interactive app detected/);
      expect(summary.states.length).toBeGreaterThanOrEqual(3);

      // it clicked into the named scenes and captured the resulting world text.
      const triggers = summary.states.map((s) => s.trigger).join(" | ");
      expect(/explored "Still Pond"|explored "Yara's Grove"/i.test(triggers)).toBe(true);
      const worldText = summary.states.map((s) => s.visibleTextExcerpt).join(" ").toLowerCase();
      expect(/still pond|yara's grove/.test(worldText)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 90_000);
});

/**
 * WALL RECOGNITION — the boundary Sage stops at cleanly instead of flailing.
 *
 * A founder inspected sagepays.xyz and watched Sage re-click "Launch" three times and blind-click
 * raw coordinates, because a connect-wallet modal opened (real change → the retired control was
 * forgiven → it clicked again). Most web3 products put a wallet or sign-in wall on the path, so
 * recognising one is not an edge case — it is the common case. The hard part is telling a real WALL
 * from the "Connect Wallet" button a web3 app keeps in its header on every single page.
 */
describe("classifyWallKind", () => {
  const nothing = { hasVisiblePassword: false, dialogText: "", bodyText: "" };

  it("a visible password field is a login wall", () => {
    expect(classifyWallKind({ ...nothing, hasVisiblePassword: true })).toBe("password");
  });

  it("a wallet-select modal offering two providers is a wallet wall", () => {
    expect(
      classifyWallKind({ ...nothing, dialogText: "Connect a Wallet\nMetaMask\nWalletConnect\nCoinbase Wallet" }),
    ).toBe("wallet");
  });

  it("one provider plus a 'connect wallet' heading is a wallet wall", () => {
    expect(classifyWallKind({ ...nothing, dialogText: "Connect your wallet\nMetaMask" })).toBe("wallet");
  });

  it("does NOT read a lone header 'Connect Wallet' button as a wall", () => {
    // The exact allbirds-drawer trap, in web3 form: the control is on every page, so the whole run
    // would abort at state ~3 if this fired. It must not.
    expect(classifyWallKind({ ...nothing, bodyText: "Home  Docs  Connect Wallet  Turn your product into a paid testing plan" })).toBeNull();
  });

  it("does NOT fire on a single provider name mentioned in page copy", () => {
    expect(classifyWallKind({ ...nothing, bodyText: "We support MetaMask and other wallets. Read the docs." })).toBeNull();
  });

  it("reads content that gates the flow behind connecting as a wallet wall", () => {
    expect(classifyWallKind({ ...nothing, bodyText: "Connect your wallet to continue to the dashboard." })).toBe("wallet");
  });

  it("recognises a third-party sign-in wall in a dialog", () => {
    expect(classifyWallKind({ ...nothing, dialogText: "Sign in\nContinue with Google\nContinue with GitHub" })).toBe("oauth");
  });

  it("is null on an ordinary product screen", () => {
    expect(classifyWallKind({ ...nothing, bodyText: "Drag a shape onto the canvas. Your drawing is saved locally." })).toBeNull();
  });

  it("password takes precedence, so a login form inside a wallet-branded page is still a login", () => {
    expect(classifyWallKind({ hasVisiblePassword: true, dialogText: "MetaMask WalletConnect", bodyText: "" })).toBe("password");
  });
});

/**
 * A WALL AT THE FRONT DOOR must still reach the doc hunt.
 *
 * The hunt first shipped inside the interactive explorer, so a product whose entire app sits behind a
 * sign-in — which classifies `static`, states 0 — could never reach it. That is the most common web3
 * shape and the one the founder specifically asked about, so the shape that needs docs most was the
 * one shape guaranteed not to get them. These pin the static path's ability to carry them.
 */
describe("the static path carries docs read at a front-door wall", () => {
  const cap = (url: string): FieldTestCapture => ({
    url, title: "Login", h1: "Sign in", ctas: [], forms: [],
    consoleErrors: [], failedRequests: [], rawHtmlTextLen: 500, renderedTextLen: 500,
    screenshot: null, visibleTextExcerpt: "Sign in to continue",
  });
  const doc = {
    url: "https://x.test/docs", title: "Docs",
    excerpt: "A connected user lands on the portfolio view.",
    soughtBecause: "login required past this point",
  };

  it("names the boundary it could not cross, per kind", () => {
    expect(wallNoteFor("wallet")).toMatch(/connect-wallet/);
    expect(wallNoteFor("oauth")).toMatch(/third-party sign-in/);
    expect(wallNoteFor("password")).toMatch(/login/);
  });

  it("a static summary carries the docs it read", () => {
    const s = buildFieldTestSummary({
      startUrl: "https://x.test", captures: [cap("https://x.test")],
      durationMs: 1, limitation: null, docs: [doc],
    });
    expect(s.mode).toBe("static");
    expect(s.docs).toHaveLength(1);
    expect(s.docs?.[0].soughtBecause).toBe("login required past this point");
  });

  it("omits the key entirely when no wall sent Sage looking", () => {
    const s = buildFieldTestSummary({
      startUrl: "https://x.test", captures: [cap("https://x.test")], durationMs: 1, limitation: null,
    });
    expect(s.docs).toBeUndefined();
  });

  it("hands those docs to the mission brain, which is the whole point", () => {
    const view = fieldTestForMap(
      buildFieldTestSummary({
        startUrl: "https://x.test", captures: [cap("https://x.test")],
        durationMs: 1, limitation: null, docs: [doc],
      }),
    );
    expect(view.docs?.[0].excerpt).toContain("portfolio view");
  });
});

/**
 * A cap that drops product content in silence is invisible until a founder finds the gap: a 900-char
 * fold cap kept ClawUp's pricing out of every corpus for weeks and no artifact said a word. These lock
 * the reporting in, and lock it to the SAME constants the view builder uses.
 */
describe("viewTruncations — the brain-view caps report what they cost", () => {
  const st = (text: string, elements = 0): FieldTestState => ({
    trigger: "clicked", screenshot: null, visibleTextExcerpt: text,
    notableElements: Array.from({ length: elements }, (_, i) => ({ tag: "button", text: `b${i}`, role: "button" })),
    pixelDeltaPct: 0, url: "https://x.test/",
  });

  it("reports NOTHING when the product fits under every cap (no false alarms)", () => {
    expect(viewTruncations([st("short", 3)], [])).toEqual([]);
  });

  it("reports characters lost when a state's text overflows the fold", () => {
    const t = viewTruncations([st("x".repeat(1000))], []);
    const text = t.find((x) => x.at === "state text");
    expect(text).toEqual({ at: "state text", kept: 800, dropped: 200, unit: "characters" });
  });

  it("sums the loss across every state the brain will actually receive", () => {
    const t = viewTruncations([st("x".repeat(900)), st("y".repeat(1000))], []);
    expect(t.find((x) => x.at === "state text")?.dropped).toBe(300);
  });

  it("reports elements the brain never sees on a control-dense screen", () => {
    // 26 controls on one screen against the cap: the report is derived from BRAIN_VIEW_CAPS, so
    // raising the cap moves both numbers together and the sum stays the truth about this screen.
    const t = viewTruncations([st("ok", 26)], []);
    const el = t.find((x) => x.at === "elements per state");
    expect(el).toEqual({ at: "elements per state", kept: 16, dropped: 10, unit: "elements" });
    expect((el?.kept ?? 0) + (el?.dropped ?? 0)).toBe(26);
  });

  it("does not double-count text inside states that were themselves cut", () => {
    // 40 states: 34 reach the brain, 6 do not — the 6 are reported as states, not again as text.
    const many = Array.from({ length: 40 }, () => st("x".repeat(1000)));
    const t = viewTruncations(many, []);
    expect(t.find((x) => x.at === "states")).toEqual({ at: "states", kept: 34, dropped: 6, unit: "states" });
    expect(t.find((x) => x.at === "state text")?.dropped).toBe(34 * 200);
  });

  it("rides on the built summary, so the loss lands in the artifact", () => {
    const s = buildInteractiveSummary({
      startUrl: "https://x.test/", states: [st("x".repeat(1000))], durationMs: 1, limitation: null,
    });
    expect(s.truncations?.find((x) => x.at === "state text")?.dropped).toBe(200);
  });
});

/**
 * A wallet-connect or sign-in wall hides the half of a web3 product that matters. Sage cannot walk
 * through it, but the product almost always documents what is behind it. These lock the RANKING: what
 * the product itself linked and named beats convention, and a route Sage was just turned away from is
 * never offered back as documentation.
 */
describe("docCandidates — where to look once a wall stops Sage", () => {
  it("prefers a path the product LINKED and NAMED as documentation", () => {
    const out = docCandidates([
      { path: "/pricing", label: "Pricing" },
      { path: "/developers", label: "Docs" },
    ]);
    expect(out[0]).toBe("/developers");
  });

  it("recognises documentation from the PATH even when the link text does not say so", () => {
    expect(docCandidates([{ path: "/docs/getting-started", label: "Start here" }])[0]).toBe("/docs/getting-started");
  });

  it("falls back to convention only to fill the remaining slots", () => {
    const out = docCandidates([{ path: "/learn", label: "Learn" }]);
    expect(out[0]).toBe("/learn");
    expect(out).toContain("/docs");
  });

  it("never offers back a route Sage was just walled out of", () => {
    const out = docCandidates([{ path: "/docs", label: "Docs" }], { exclude: ["/docs"] });
    expect(out).not.toContain("/docs");
  });

  it("ignores off-site and anchor-only links, and dedupes", () => {
    const out = docCandidates([
      { path: "https://docs.other.com", label: "Docs" },
      { path: "/guide#top", label: "Guide" },
      { path: "/guide", label: "Guide" },
    ]);
    expect(out.filter((p) => p === "/guide")).toHaveLength(1);
    expect(out.every((p) => p.startsWith("/"))).toBe(true);
  });

  it("stays bounded — a doc hunt must never become a crawl", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `/docs/${i}`, label: "Docs" }));
    expect(docCandidates(many).length).toBeLessThanOrEqual(3);
  });

  it("does not mistake ordinary marketing words for documentation", () => {
    const out = docCandidates([
      { path: "/careers", label: "Careers" },
      { path: "/blog", label: "Blog" },
    ]);
    expect(out).not.toContain("/careers");
    expect(out).not.toContain("/blog");
  });
});
