import { describe, it, expect } from "vitest";
import { MISSION_INTERACTION } from "./mission-brain";

/**
 * THE NOUN THAT PASSED FOR AN ACTION. Measured on sagepays.xyz (2026-08-15): Sage shipped a plan of
 * two pure reading missions — "navigate to the dashboard and VERIFY the wallet connection
 * requirement and messaging", "navigate to the homepage and VERIFY the value proposition". The
 * deterministic backstop that exists to catch exactly that (no accepted mission asks the tester to
 * DO anything → ask the architect for one) never fired, because `connect\w*` matched the noun
 * "connection". `add\w*` matched "address", `creat\w*` matched "creation", `start\w*` matched
 * "startup". A guard a noun can satisfy is not a guard.
 */
const READING = [
  "Navigate to the dashboard page and verify the wallet connection requirement and messaging",
  "Navigate to the homepage and verify the core value proposition and key features are clearly communicated",
  "Confirm the payout address is shown on the receipt page",
  "Check that agent creation is explained in the documentation",
  "Read the startup guide and report what it says",
  "Verify the pricing information is accurate",
];

const DOING = [
  "Sign up, then create your first agent and chat with it",
  "Connect a messaging channel to a fresh agent",
  "Enter your product's URL and start the inspection",
  "Click Continue, then paste your product URL",
  "Add a repo and submit the form",
  "Deploy the vault and publish the plan",
  "Upload a file, then toggle the setting",
  "Search for a token and filter the results",
];

describe("MISSION_INTERACTION — does this mission ask the tester to DO something?", () => {
  it.each(READING)("rejects the reading mission: %s", (title) => {
    expect(MISSION_INTERACTION.test(title)).toBe(false);
  });

  it.each(DOING)("accepts the action mission: %s", (title) => {
    expect(MISSION_INTERACTION.test(title)).toBe(true);
  });

  it("the four nouns that leaked, named individually so they can never come back", () => {
    for (const noun of ["connection", "address", "creation", "startup", "connections"]) {
      expect(MISSION_INTERACTION.test(`verify the ${noun} is correct`)).toBe(false);
    }
  });
});
