import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WHEN A RENDERED CAPTURE REPLACES THE STATIC ONE.
 *
 * The condition was `rendered.length > static.length` — LENGTH as a proxy for information.
 *
 * MEASURED on starkscan.co: the render returned 2,561 characters containing the contract name, the
 * tab strip and the transaction summary, and was discarded in favour of a 2,753-character static
 * shell padded with a cookie banner and site nav. Every part of the chain worked — trigger,
 * browser, guard, proxy — and the last comparison threw the answer away. Two judgments held on
 * correct evidence because of it.
 *
 * A render only runs when the static text was ALREADY judged a shell. Once that is decided,
 * "longer" is not the question; the only thing left to check is that the browser came back with
 * something rather than an error page.
 */

const renderEvidence = vi.fn();
vi.mock("./evidence-render", () => ({
  renderEvidence: (...a: unknown[]) => renderEvidence(...(a as [])),
  RENDERER_VERSION: "render-v1",
}));

import { fetchEvidence } from "./evidence";

/** A shell: enough chrome to beat the 200-char thin rule, and a loading word so the render fires. */
const SHELL = `Home Contracts Checking… ${"nav ".repeat(500)}`;
const html = (body: string) => `<html><body>${body}</body></html>`;

const fetchImpl = (body: string) =>
  (async () =>
    new Response(html(body), { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;

afterEach(() => {
  delete process.env.RENDERED_EVIDENCE_MODE;
  renderEvidence.mockReset();
});

describe("enforce: which capture the judge reads", () => {
  it("uses a SHORTER rendered capture when it is the real page", async () => {
    // The exact shape that was being discarded.
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    // Realistic: the real capture was 2,561 chars against a 2,753-char shell. Short ENOUGH to have
    // been discarded by the old length rule, long enough to be real evidence.
    renderEvidence.mockResolvedValue({
      text: `Starknet: Attestation Activity Token Transfers Messages Events Contract 20 indexed transactions · 20 transactions loaded ${"row ".repeat(300)}`,
      outcome: "ok",
      finalUrl: "https://x.test/",
    });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(SHELL) });
    expect(r.mode).toBe("rendered");
    expect(r.text).toContain("Starknet: Attestation");
    expect(r.text.length).toBeLessThan(SHELL.length);
  });

  it("keeps the static capture when the browser came back with nothing", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    renderEvidence.mockResolvedValue({ text: "", outcome: "empty", finalUrl: null });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(SHELL) });
    expect(r.mode).not.toBe("rendered");
  });

  it("keeps the static capture when the render returned a scrap", async () => {
    // An error page or a redirect notice is not evidence. Below the thin threshold it is refused
    // for the same reason the static text was.
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    renderEvidence.mockResolvedValue({ text: "Access denied", outcome: "ok", finalUrl: null });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(SHELL) });
    expect(r.mode).not.toBe("rendered");
  });

  it("SHADOW never changes what the judge reads, however good the render is", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "shadow";
    renderEvidence.mockResolvedValue({
      text: "Starknet: Attestation Token Transfers 20 indexed transactions",
      outcome: "ok",
      finalUrl: null,
    });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(SHELL) });
    expect(r.mode).not.toBe("rendered");
    expect(r.text).not.toContain("Starknet: Attestation");
    // The comparison is still recorded — that is the whole point of shadow.
    expect(r.render?.renderedLen).toBeGreaterThan(0);
  });

  it("OFF never launches a browser at all", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "off";
    await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(SHELL) });
    expect(renderEvidence).not.toHaveBeenCalled();
  });
});

/**
 * THE PRODUCT PAGE THAT IS NOT A SHELL (2026-09-11). plausible.io's live demo returned 2,155 characters
 * of chrome and prose to the plain fetch — no loading word, a small payload, plenty of text — so no
 * shell heuristic fired and the judge held on "the page shows no visitor numbers". The numbers render
 * client-side. The judge now says when a link is a page on the product (`preferRender`); the render is
 * then a second opinion that must clear half the static text to replace it.
 */
describe("enforce: a product page the caller asked to render", () => {
  /** rich, not thin: no loading words, well over the thin floor, a small payload (no ratio trigger). */
  const RICH = `Plausible live demo dashboard. Simple, privacy-friendly analytics for your site. ${"Top pages, top sources, visitors and pageviews. ".repeat(20)}`;

  it("renders on the caller's word alone, and the judge reads the rendered capture", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    const rendered = `Visitors 12.4k · Pageviews 31.2k · Top pages /blog /pricing ${"row ".repeat(200)}`;
    renderEvidence.mockResolvedValue({ text: rendered, outcome: "ok", finalUrl: "https://x.test/" });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(RICH), preferRender: true });
    expect(renderEvidence).toHaveBeenCalledTimes(1);
    expect(r.mode).toBe("rendered");
    expect(r.text).toContain("Visitors 12.4k");
    expect(r.render?.triggerReason).toBe("product_page");
  });

  it("keeps the static capture when the browser came back with a fraction of the page (a wall)", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    renderEvidence.mockResolvedValue({ text: `Accept cookies to continue. ${"nav ".repeat(60)}`, outcome: "ok", finalUrl: "https://x.test/" });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(RICH), preferRender: true });
    expect(r.mode).toBe("static");
    expect(r.text).toContain("Plausible live demo dashboard");
    // The attempt is still on the record, with its reason.
    expect(r.render).toMatchObject({ triggerReason: "product_page", outcome: "ok" });
  });

  it("does not render a rich page nobody asked to render (the shell rules are unchanged)", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(RICH) });
    expect(renderEvidence).not.toHaveBeenCalled();
    expect(r.mode).toBe("static");
  });

  it("a shell still wins on arriving — the half-the-static floor applies only to the product-page trigger", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    renderEvidence.mockResolvedValue({ text: `Real content ${"row ".repeat(60)}`, outcome: "ok", finalUrl: "https://x.test/" });
    const r = await fetchEvidence("https://x.test/", { fetchImpl: fetchImpl(SHELL), preferRender: true });
    expect(r.mode).toBe("rendered");
    expect(r.render?.triggerReason).not.toBe("product_page");
  });
});
