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
  interactiveClassification,
  canvasStrokes,
  explorationCounts,
  fieldTestForMap,
  runFieldTest,
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
        // Inject permissive guards so the loopback fixture is allowed (prod uses the real SSRF guards).
        { isPublicHost: async () => true, allowUrl: () => ({ allow: true, reason: "test" }), publicDir },
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
        { isPublicHost: async () => true, allowUrl: () => ({ allow: true, reason: "test" }), publicDir },
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
        { isPublicHost: async () => true, allowUrl: () => ({ allow: true, reason: "test" }), publicDir },
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
