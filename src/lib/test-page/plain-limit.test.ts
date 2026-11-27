import { describe, expect, it } from "vitest";
import { plainLimit } from "./plain-limit";

describe("plainLimit: what Sage could not see, in a builder's words", () => {
  it("says the pages Sage left for the people who try it, counted", () => {
    expect(
      plainLimit(
        "3 additional same-origin page(s) were discovered but not inspected within the page budget.",
      ),
    ).toBe(
      "Sage read the main pages and left 3 more pages for the people who try it.",
    );
    expect(
      plainLimit(
        "1 additional same-origin page(s) were discovered but not inspected within the page budget.",
      ),
    ).toBe(
      "Sage read the main pages and left 1 more page for the people who try it.",
    );
  });

  it("says what is behind a sign-in plainly", () => {
    expect(
      plainLimit(
        "Sage explored the live product in a real browser; anything behind a login, or a specific interaction Sage didn't perform, may still be under-observed.",
      ),
    ).toBe(
      "Screens behind a sign-in, and anything Sage did not click, are for the people who try it.",
    );
  });

  it("tells the builder how to steer the missions", () => {
    expect(
      plainLimit(
        "No specific goal was given, so Sage planned for a first-time visitor's primary flow — state a goal to steer the missions.",
      ),
    ).toBe(
      "You did not name a goal, so the missions follow a first-time visitor. Name one to steer them.",
    );
  });

  it("keeps a limit it does not know exactly as written", () => {
    expect(plainLimit("  The store listing is all Sage could read.  ")).toBe(
      "The store listing is all Sage could read.",
    );
  });
});
