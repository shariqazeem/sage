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
