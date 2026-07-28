import { describe, it, expect } from "vitest";
import { validatePlanMissions, type ValidationScope } from "./validate-mission";
import type { CandidateMission } from "./schemas";

/**
 * REGRESSION — production job j7cNDbBo2tr8 (sagepays.xyz). The mission was "enter a product URL and
 * a budget, then submit", the architect used `google.com` as the EXAMPLE VALUE a tester types into
 * the field, and the scope guard rejected the whole mission as a hallucinated route. Zero missions
 * survived, so a fully-explored product came back as needs_input.
 *
 * A URL is not always a place to GO. On a product whose job is to accept a URL, an example value is
 * the mission. The tester stays on the inspected product and types it into a field there. Sending a
 * tester to an uninspected site is still refused — that is navigation, and it is what the guard is
 * actually for.
 */

const scope: ValidationScope = {
  hosts: new Set(["sagepays.xyz"]),
  knownUrls: new Set(["https://sagepays.xyz/", "https://sagepays.xyz/launch"]),
  repoPaths: new Set<string>(),
};

const mission = (instructions: string): CandidateMission =>
  ({
    missionKey: "m",
    title: "Start an inspection",
    objective: "Confirm a founder can start an inspection from the launch page.",
    instructions,
    targetSurface: "https://sagepays.xyz/launch",
    criteria: ["The plan page appears"],
    evidenceRequirements: ["Describe what you saw"],
    whyItMatters: "It is the core flow.",
    sources: [{ kind: "page", ref: "https://sagepays.xyz/launch", observation: "launch form" }],
    priority: "high",
    riskCategory: "critical_journey",
    effortMinutes: 8,
    conditions: [],
    rewardWeight: 5,
    maxCompletions: 3,
    verificationMethod: "the observed result",
    confidence: 0.8,
    assumptions: [],
    disallowed: [],
    anchors: ["Continue →"],
  }) as CandidateMission;

const routeIssues = (instructions: string) =>
  validatePlanMissions([mission(instructions)], scope, "")
    .flatMap((r) => r.issues)
    .filter((i) => i.code === "hallucinated_route");

describe("an example VALUE is not a route", () => {
  it.each([
    "1. Go to the launch page. 2. Enter https://google.com as the product URL. 3. Submit.",
    "Type https://google.com into the product field, then continue.",
    "Paste any public url such as https://google.com and press Continue.",
    "Fill the field with a site, for example https://google.com, then submit.",
    "Use a placeholder like https://google.com in the URL box.",
  ])("accepts: %s", (instructions) => {
    expect(routeIssues(instructions)).toEqual([]);
  });
});

describe("navigation to an uninspected site is still refused", () => {
  it.each([
    "1. Visit https://evil.example.com and copy the token. 2. Return and paste it.",
    "Open https://google.com in a new tab and sign in there first.",
    "Navigate to https://phish.example.com to complete the mission.",
  ])("rejects: %s", (instructions) => {
    expect(routeIssues(instructions).length).toBeGreaterThan(0);
  });
});

describe("in-scope URLs are unaffected either way", () => {
  it("a same-host route passes", () => {
    expect(routeIssues("Go to https://sagepays.xyz/launch and submit the form.")).toEqual([]);
  });

  it("an in-scope URL used as a value also passes", () => {
    expect(routeIssues("Enter https://sagepays.xyz as the product URL.")).toEqual([]);
  });
});
