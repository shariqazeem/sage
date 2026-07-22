import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestGuard } from "@/lib/launch/field-test";

/**
 * Security + rollout acceptance tests for the rendered-evidence capture (W2). The BROWSER itself is not
 * launched here (no third-party CI fixture — excalidraw.com stays a documented manual smoke test); we
 * test the two things that decide safety deterministically: (1) the per-request SSRF/scheme guard the
 * renderer applies to EVERY request, and (2) the three-state rollout in `fetchEvidence` — that OFF never
 * renders, SHADOW records a comparison but never changes what the judge sees, ENFORCE substitutes only
 * richer rendered text, an unknown mode fails to OFF, and any renderer failure preserves the static
 * result. The renderer is mocked so no browser/native dep loads.
 */
const renderMock = vi.fn();
vi.mock("./evidence-render", () => ({
  renderEvidence: (...a: unknown[]) => renderMock(...a),
  RENDERER_VERSION: "render-test",
}));

import { fetchEvidence } from "./evidence";

const THIN_HTML = '<html><body><div id="root"></div></body></html>';
const thinFetch = (async () =>
  new Response(THIN_HTML, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
const richFetch = (async () =>
  new Response("<html><body>" + "Real static content. ".repeat(40) + "</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  })) as unknown as typeof fetch;
const RENDERED = "The tester created a document titled Report and the autosave indicator confirmed it saved successfully.";

beforeEach(() => {
  renderMock.mockReset();
  delete process.env.RENDERED_EVIDENCE_MODE;
  delete process.env.RENDERED_EVIDENCE;
});
afterEach(() => {
  delete process.env.RENDERED_EVIDENCE_MODE;
  delete process.env.RENDERED_EVIDENCE;
});

describe("renderer SSRF/scheme guard — applied to the entry AND every subresource", () => {
  const BLOCKED = [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://[::1]/x",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata / link-local
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://x/y",
    "ws://evil.example/x",
    "ftp://evil.example/x",
  ];
  for (const u of BLOCKED) {
    it(`blocks ${u}`, () => expect(requestGuard(u).allow).toBe(false));
  }
  it("allows a public https URL (format) — the DNS public-host check is a separate layer", () => {
    expect(requestGuard("https://example.com/evidence").allow).toBe(true);
  });
});

describe("three-state rollout — OFF | SHADOW | ENFORCE", () => {
  it("OFF (default): never invokes the renderer; static path unchanged", async () => {
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
    expect(renderMock).not.toHaveBeenCalled();
    expect(r.mode).toBe("static");
    expect(r.render).toBeUndefined();
  });

  it("unknown mode value → OFF (fails safe)", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "yolo";
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
    expect(renderMock).not.toHaveBeenCalled();
    expect(r.mode).toBe("static");
  });

  it("legacy RENDERED_EVIDENCE=1 → SHADOW, never enforce (records, judge sees static)", async () => {
    process.env.RENDERED_EVIDENCE = "1";
    renderMock.mockResolvedValue({ text: RENDERED, outcome: "ok", finalUrl: "https://example.org/spa" });
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(r.mode).toBe("static"); // legacy can NEVER enforce
    expect(r.text).not.toContain("autosave"); // judge input is the static shell, not the rendered text
    expect(r.render?.mode).toBe("shadow");
    expect(r.render?.renderedLen).toBe(RENDERED.length);
  });

  it("SHADOW: runs the renderer + records the comparison, but the JUDGE SEES STATIC (unchanged input)", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "shadow";
    renderMock.mockResolvedValue({ text: RENDERED, outcome: "ok", finalUrl: "https://example.org/spa" });
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
    expect(r.mode).toBe("static");
    expect(r.text).not.toContain("autosave"); // the rendered text NEVER reaches the judge in shadow
    expect(r.render).toMatchObject({ mode: "shadow", outcome: "ok", renderedLen: RENDERED.length, rendererVersion: "render-test", triggerReason: "thin_text" });
    expect(r.render?.staticDigest).toBeTruthy();
    expect(r.render?.renderedDigest).toBeTruthy();
    // provenance carries NO raw page text
    expect(JSON.stringify(r.render)).not.toContain("autosave");
  });

  it("ENFORCE + richer rendered text → the judge sees the RENDERED text", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    renderMock.mockResolvedValue({ text: RENDERED, outcome: "ok", finalUrl: "https://example.org/spa" });
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
    expect(r.mode).toBe("rendered");
    expect(r.text).toContain("autosave");
    expect(r.render?.mode).toBe("enforce");
  });

  it("ENFORCE but rendered NOT richer than a non-empty thin static → keeps static", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    // a thin-but-non-empty static ("Loading…" placeholder, still < 200 chars) with a SHORTER render.
    const thinWithText = (async () =>
      new Response("<html><body>Loading the application, please wait a moment.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    renderMock.mockResolvedValue({ text: "Loading", outcome: "ok", finalUrl: null });
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinWithText });
    expect(r.mode).toBe("static");
    expect(r.text).toContain("Loading the application"); // the richer static is kept
    expect(r.render?.mode).toBe("enforce");
  });

  it("renderer FAILURE preserves the static result (shadow + enforce), records the failure category", async () => {
    for (const mode of ["shadow", "enforce"] as const) {
      process.env.RENDERED_EVIDENCE_MODE = mode;
      renderMock.mockResolvedValue({ text: null, outcome: "timeout", finalUrl: null });
      const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
      expect(r.mode).toBe("static");
      expect(r.render?.outcome).toBe("timeout");
      expect(r.render?.renderedLen).toBeNull();
    }
  });

  it("renderer THROWING preserves the static result (never breaks a decision)", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    renderMock.mockRejectedValue(new Error("boom"));
    const r = await fetchEvidence("https://example.org/spa", { fetchImpl: thinFetch });
    expect(r.mode).toBe("static");
    expect(r.text).not.toContain("autosave");
  });

  it("RICH static (not thin) → never triggers a render, in any mode", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    const r = await fetchEvidence("https://example.org/page", { fetchImpl: richFetch });
    expect(renderMock).not.toHaveBeenCalled();
    expect(r.mode).toBe("static");
  });
});
