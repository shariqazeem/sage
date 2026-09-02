import { describe, expect, it } from "vitest";
import { coerceMission, defaultVerificationMethod } from "./mission-brain";
import { validateMission, type ValidationScope } from "./validate-mission";

/**
 * yara.garden, P-GEN 45 (2026-09-02): the architect designed ONE mission for an 18-state world, the
 * critic accepted it on every rubric point, and the deterministic gate refused it for a single empty
 * prose field — `verificationMethod`. The founder got `needs_input` with two generic questions.
 *
 * The method Sage applies is a fact about the pipeline, not the model's opinion, so a missing one is
 * now stated deterministically from the mission's evidence shape. The gate still refuses an EMPTY
 * method; what changed is that a reviewer-accepted mission can no longer die on a line of prose.
 */
const base = {
  missionKey: "walk-the-intake",
  title: "Complete the first-time welcome flow",
  objective: "Walk the intake from 'tap to step inside' to the 'Meet Yara' screen.",
  instructions: "1. Open the page. 2. Click 'tap to step inside'. 3. Enter a name. 4. Click 'come in →'.",
  targetSurface: "https://yara.garden/",
  criteria: ["The screen shows 'Meet Yara' after 'come in →' is clicked."],
  evidenceRequirements: ["Quote the exact heading text shown after 'come in →'."],
  whyItMatters: "This is the only door into the product; a first-time visitor who gets stuck here never sees anything else.",
  sources: ["https://yara.garden/"],
  anchors: ["tap to step inside", "come in →"],
};

describe("coerceMission — a missing verificationMethod is stated by code, never left empty", () => {
  it("fills an omitted method from the evidence shape and preserves a model-provided one verbatim", () => {
    const filled = coerceMission({ ...base }, 0);
    expect(filled).not.toBeNull();
    expect(filled!.verificationMethod.length).toBeGreaterThan(40);
    expect(filled!.verificationMethod).toBe(defaultVerificationMethod(base));

    const own = coerceMission({ ...base, verificationMethod: "Sage matches the quoted heading." }, 0);
    expect(own!.verificationMethod).toBe("Sage matches the quoted heading.");

    const blank = coerceMission({ ...base, verificationMethod: "   " }, 0);
    expect(blank!.verificationMethod).toBe(defaultVerificationMethod(base));
  });

  it("describes what the pipeline actually does for each verifiability class", () => {
    const url = defaultVerificationMethod({
      objective: "Reach the pricing page and quote the plan names.",
      criteria: ["The page at https://example.com/pricing shows the text 'Starter'."],
      evidenceRequirements: ["The URL reached and the exact quoted plan name."],
    });
    expect(url).toMatch(/re-opens the cited public page/);
    const obs = defaultVerificationMethod({
      objective: "Switch companions and report what changes.",
      criteria: ["The companion's name changes in the greeting after switching."],
      evidenceRequirements: ["Describe in your own words what changed on screen."],
    });
    expect(obs).toMatch(/own account of what happened/);
    expect(url).not.toBe(obs);
  });

  it("the gate still refuses an EMPTY method — the default is a fill, not a weakening", () => {
    const scope: ValidationScope = { knownUrls: new Set(["https://yara.garden/"]), hosts: new Set(["yara.garden"]), repoPaths: new Set() };
    const corpus = "Yara — A GENTLE WORLD TO HEAL. tap to step inside. come in → Meet Yara";
    const m = coerceMission({ ...base }, 0)!;
    expect(validateMission(m, scope, corpus).issues.some((x) => x.field === "verificationMethod")).toBe(false);
    const stripped = { ...m, verificationMethod: "" };
    expect(validateMission(stripped, scope, corpus).issues.some((x) => x.code === "empty_field" && x.field === "verificationMethod")).toBe(true);
  });
});
