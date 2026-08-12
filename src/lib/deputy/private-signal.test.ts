import { describe, it, expect } from "vitest";
import { privateSignalSources, distillPrivateKey, OBS_BAR } from "./observation-verify";
import type { FieldTestSummary } from "@/lib/launch/schemas";

/**
 * CALIBRATION for the autonomy readiness gate (safe-by-direction: it only ever HOLDS more).
 * A RICH corpus — distinct private states a card-parrot never saw — must stay autonomous. A
 * PUBLIC-HEAVY corpus — where the mission criteria quote the same vocabulary the "private"
 * observations carry — must flip to founder-review, because there a parrot is indistinguishable.
 */
const ft = (states: string[]): FieldTestSummary =>
  ({
    ran: true,
    mode: "interactive",
    pages: [],
    states: states.map((t, i) => ({ trigger: `s${i}`, screenshot: null, visibleTextExcerpt: t, notableElements: [], pixelDeltaPct: 0, url: "https://x/" })),
  }) as unknown as FieldTestSummary;

describe("privateSignalSources — rich stays autonomous, public-heavy holds", () => {
  it("a rich interactive corpus clears the autonomy bar", () => {
    // distinct game/app states with specific private detail no card would quote.
    const rich = ft([
      "Yara greets you warmly by the wishing tree at dusk",
      "floating paper lanterns drift over the moonlit grove path",
      "a stone lantern glows beside the koi pond ripples",
      "the merchant offers a carved jade pendant for three coins",
      "wind chimes ring as the bamboo gate slides open slowly",
      "a hidden alcove reveals an old brass telescope pointed skyward",
    ]);
    const publicStrings = ["Explore Yara's garden", "Talk to Yara", "Reach the target and have a real exchange"];
    const signal = privateSignalSources(rich, publicStrings);
    expect(signal).toBeGreaterThanOrEqual(OBS_BAR.minKeySources);
  });

  it("a public-heavy corpus (criteria quote the same words) flips to hold", () => {
    // the 'private' states are dominated by the SAME vocabulary the public criteria carry.
    const states = [
      "Build and Power Up Your AI Agent",
      "Works with leading agent frameworks Nous Portal OpenRouter",
      "200+ models via Nous Portal and OpenRouter",
      "Simple pay-as-you-go pricing per call",
      "Instant Launch Memory Inheritance Identity Ecosystem",
      "agent frameworks OpenClaw Hermes Agent Nous Research",
    ];
    const publicHeavy = ft(states);
    // the plan criteria quote exactly this product vocabulary (parrot-zero can't separate them)
    const publicStrings = [
      "Verify the homepage mentions Build and Power Up Your AI Agent",
      "Works with leading agent frameworks Nous Portal OpenRouter",
      "confirm 200+ models via Nous Portal and OpenRouter",
      "Simple pay-as-you-go pricing per call",
      "Instant Launch Memory Inheritance Identity Ecosystem",
      "agent frameworks OpenClaw Hermes Agent Nous Research",
    ];
    const signal = privateSignalSources(publicHeavy, publicStrings);
    // it can still have distinct SOURCES by raw count, but few carry NON-public signal
    expect(signal).toBeLessThan(OBS_BAR.minKeySources);
    expect(distillPrivateKey(publicHeavy, publicStrings).distinctSources).toBeGreaterThanOrEqual(0);
  });
});
