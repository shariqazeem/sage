import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  requestGuard,
  visibleTextLen,
  computeJsOnly,
  buildFieldTestSummary,
  fieldTestForMap,
  runFieldTest,
  type FieldTestCapture,
} from "./field-test";

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

describe("fieldTestForMap", () => {
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
    expect(forMap).toHaveLength(1);
    const p = forMap[0];
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
    expect(JSON.stringify(forMap)).not.toContain("forms");
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
