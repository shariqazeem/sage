import { describe, it, expect } from "vitest";
import { goalRequiresUse, type GoalJourneyV1 } from "./goal-journey";
import { classifyMode, type ProductSignals } from "./field-test";

/**
 * REGRESSION — production job 2XruYQs-qQ9B. A founder asked Sage to test sagepays.xyz so that
 * "users launch campaign", with a $50 budget. Sage crawled six pages of HTML, clicked NOTHING, and
 * failed for want of grounded evidence.
 *
 * Cause: every interactive branch of `classifyMode` required `thinText` (<600 rendered chars), so a
 * text-rich app could never be explored. That rule is right for READING a product and wrong for
 * USING one — no amount of HTML proves a tester can launch a campaign. In the last 7 days it left
 * 14 of 68 requests without a single interactive state, and every remaining hard failure traced to
 * it.
 */

const richTextApp: ProductSignals = {
  hasCanvas: false,
  canvasArea: 0,
  webgl: false,
  keyListeners: false,
  gamepad: false,
  spaRouting: true,
  selfAnimates: false,
  renderedTextLen: 4200, // a normal marketing/app page
} as ProductSignals;

describe("the founder's intent decides whether Sage uses the product", () => {
  it("a text-rich app IS explored when the goal names work to perform", () => {
    // the exact request that failed
    expect(goalRequiresUse("make users launch campaign, funding not required")).toBe(true);
    expect(classifyMode(richTextApp, true)).toBe("interactive");
  });

  it("without that intent a text-rich page is still a crawl — unchanged behaviour", () => {
    expect(classifyMode(richTextApp, false)).toBe("static");
    expect(classifyMode(richTextApp)).toBe("static");
  });

  it.each([
    "make users land in the app and go to the character and talk to her",
    "testers should complete a full checkout and report the confirmation number",
    "a tester should sign up and finish onboarding",
    "get users to create a project and invite a teammate",
    "have people play until they reach a high score",
    "users should be able to search and filter results",
  ])("recognises work in: %s", (goal) => {
    expect(goalRequiresUse(goal)).toBe(true);
  });

  it.each([
    "check that the pricing page loads",
    "validate the core experience for a first-time user",
    "review the landing page copy for clarity",
    "is the value proposition clear on the homepage",
  ])("stays a crawl for: %s", (goal) => {
    expect(goalRequiresUse(goal)).toBe(false);
  });

  it("an empty or absent goal never forces exploration", () => {
    for (const g of ["", "   ", null, undefined]) expect(goalRequiresUse(g)).toBe(false);
  });
});

describe("the compiled journey outranks the wording", () => {
  const journey = (kinds: string[]): GoalJourneyV1 =>
    ({
      goal: "wording that names no action at all",
      checkpoints: kinds.map((kind, i) => ({ checkpointId: `cp${i}`, kind, requirement: "r" })),
    }) as unknown as GoalJourneyV1;

  it("an actionable checkpoint forces exploration even when the words look passive", () => {
    for (const kind of ["interaction", "input", "outcome"]) {
      expect(goalRequiresUse("wording that names no action at all", journey([kind]))).toBe(true);
    }
  });

  it("a journey of pure navigation/state does not force it on its own", () => {
    expect(goalRequiresUse("review the page", journey(["entry", "navigation", "state"]))).toBe(false);
  });

  it("an absent journey falls back to the goal's words", () => {
    expect(goalRequiresUse("make users launch a campaign", null)).toBe(true);
    expect(goalRequiresUse("review the page", null)).toBe(false);
  });
});

describe("the render-based rules still work when intent is absent", () => {
  it("a thin self-animating DOM is still interactive", () => {
    expect(
      classifyMode({ ...richTextApp, renderedTextLen: 120, selfAnimates: true }, false),
    ).toBe("interactive");
  });

  it("a big canvas is still interactive", () => {
    expect(
      classifyMode(
        { ...richTextApp, hasCanvas: true, canvasArea: 1_000_000, webgl: true },
        false,
      ),
    ).toBe("interactive");
  });
});
