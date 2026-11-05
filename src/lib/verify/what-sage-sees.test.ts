import { describe, expect, it } from "vitest";
import { markerCriterion, proofPlatform, SIGHT, walletLine, whatSageSeesText } from "./what-sage-sees";

/**
 * WHAT SAGE SEES (6 Nov 2026): one table that the drafter's prompt, the composer's wallet line and criterion,
 * the feasibility check and the bench's auditor all read, so none of them can describe a check that isn't there.
 */
describe("what Sage sees, per platform", () => {
  it("names the platform a proof lives on from what the job says about it", () => {
    expect(proofPlatform({ prMerged: true, allowedHosts: ["github.com"] })).toBe("github_pull");
    expect(proofPlatform({ minRows: 50, allowedHosts: ["docs.google.com"] })).toBe("google_sheet");
    expect(proofPlatform({ allowedHosts: ["youtube.com"] })).toBe("video");
    expect(proofPlatform({ allowedHosts: ["x.com"] })).toBe("social_post");
    expect(proofPlatform({ allowedHosts: ["www.figma.com"] })).toBe("design");
    expect(proofPlatform({ allowedHosts: ["myshop.example"] })).toBe("page");
    expect(proofPlatform({ allowedHosts: [] })).toBeNull();
    expect(proofPlatform({ allowedHosts: ["x.com", "bsky.app"] })).toBeNull();
  });

  it("tells the worker where the wallet goes, and words the criterion for where the check looks", () => {
    expect(walletLine({ prMerged: true })).toMatch(/in the pull request description/);
    expect(walletLine({ minRows: 10 })).toMatch(/in a cell on that same tab/);
    expect(walletLine({ allowedHosts: [] })).toMatch(/visibly in the work you submit/);
    expect(markerCriterion({ prMerged: true })).toBe("The pull request description carries the submitting wallet address");
    expect(markerCriterion({ minRows: 10 })).toBe("The linked tab shows the submitting wallet address in a cell");
    expect(markerCriterion({ allowedHosts: ["youtube.com"] })).toBe("The video description carries the submitting wallet address");
    expect(markerCriterion({})).toBe("The page carries the submitting wallet address");
  });

  it("says plainly what Sage never sees", () => {
    expect(SIGHT.video.sees).toMatch(/never the picture or the sound/);
    expect(SIGHT.google_sheet.sees).toMatch(/ONE tab/);
    expect(SIGHT.design.sees).toMatch(/never the canvas/);
    const text = whatSageSeesText();
    expect(text).toMatch(/a Google Sheet[^\n]*the cell values of the ONE tab/);
    expect(text).toMatch(/Sage cannot open:[^\n]*drive\.google\.com/);
  });
});
