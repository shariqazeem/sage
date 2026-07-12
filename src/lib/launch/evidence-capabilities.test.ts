import { describe, expect, it } from "vitest";
import { detectUnsupportedEvidence, SUPPORTED_EVIDENCE, UNSUPPORTED_EVIDENCE, EVIDENCE_CAPABILITY_PROMPT } from "./evidence-capabilities";

/**
 * The gate that stops the Mission Brain from generating work Sage cannot verify. A mission
 * requiring a screenshot / image / video / file / private evidence must be caught (so it is
 * regenerated before a founder sees it); a mission verifiable from a public URL + quoted
 * text + observation must pass cleanly. Conservative — "describe the image in text" is fine.
 */

describe("detectUnsupportedEvidence — rejects what Sage cannot ingest", () => {
  const cases: [string, string][] = [
    ["a screenshot", "Screenshot highlighting the primary CTA"],
    ["screen recording", "A screen recording of the checkout flow"],
    ["a video", "Provide a short video of the animation"],
    ["image upload", "Upload an image of the landing page"],
    ["a photo", "Attach a photo of the result"],
    ["a png file extension", "A .png of the hero section"],
    ["a file upload", "Upload the exported file"],
    ["a pdf", "Attach the generated report.pdf"],
    ["logged-in evidence", "A screenshot from your logged-in dashboard"],
    ["authenticated evidence", "Authenticated account data proving the purchase"],
  ];
  for (const [name, req] of cases) {
    it(`rejects ${name}`, () => {
      const hit = detectUnsupportedEvidence({ evidenceRequirements: [req] });
      expect(hit, `expected ${name} to be caught`).not.toBeNull();
    });
  }

  it("catches an unsupported artifact demanded in a criterion or instruction", () => {
    expect(detectUnsupportedEvidence({ evidenceRequirements: ["A public URL"], criteria: ["Must include a screenshot"] })).not.toBeNull();
    expect(detectUnsupportedEvidence({ evidenceRequirements: ["A public URL"], instructions: "Take a screenshot and upload it." })).not.toBeNull();
  });
});

describe("detectUnsupportedEvidence — accepts supported text-only evidence", () => {
  const ok: string[][] = [
    ["A public HTTPS URL to the page you tested", "The exact quoted text of the primary call-to-action", "A 2-3 sentence observation of what you saw"],
    ["Link to the docs page", "Quote the exact heading that describes the download step"],
    ["The URL where the value proposition appears", "The verbatim sentence stating the product's purpose"],
    // "image" as a thing to DESCRIBE (not upload) must not false-positive.
    ["A public URL", "Describe in text what the hero image communicates"],
  ];
  for (const reqs of ok) {
    it(`accepts: ${reqs[0].slice(0, 30)}…`, () => {
      expect(detectUnsupportedEvidence({ evidenceRequirements: reqs })).toBeNull();
    });
  }
});

describe("evidence capability constants", () => {
  it("the prompt block names every supported + unsupported type", () => {
    for (const s of SUPPORTED_EVIDENCE) expect(EVIDENCE_CAPABILITY_PROMPT).toContain(s);
    for (const u of UNSUPPORTED_EVIDENCE) expect(EVIDENCE_CAPABILITY_PROMPT).toContain(u);
  });
});
