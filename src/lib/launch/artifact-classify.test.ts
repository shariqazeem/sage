import { describe, it, expect } from "vitest";
import { classifyVerifiability } from "./validate-mission";

/**
 * THE ARTIFACT MONEY GATE (rule 6a). Real work behind a signup gate becomes autonomously payable when
 * the tester CREATES something public and hands over its URL — Sage fetches that URL exactly as it
 * fetches any other. This pins both directions: the artifact form pays; the attacks do not.
 */
const m = (objective: string, criteria: string[], evidence: string[] = []) =>
  ({ objective, criteria, evidenceRequirements: evidence });

describe("classifyVerifiability — the artifact mission is auto-payable", () => {
  it("PAYS: create the agent, give the public URL of the created agent + its heading", () => {
    expect(
      classifyVerifiability(
        m(
          "Sign up and create your first agent, then provide the public URL of the created agent.",
          ["The tester creates an agent and provides the public URL of the created agent page, which displays the agent's name as a heading."],
          ["The public URL of the agent you created.", "The exact heading shown on that page."],
        ),
      ),
    ).toBe("url-verifiable");
  });

  it("PAYS: a published/deployed artifact with its share link and shown text", () => {
    expect(
      classifyVerifiability(
        m(
          "Publish a store and submit its link.",
          ["The tester provides the link for the newly created store page, and that page shows the store name."],
          ["The public link of the store you published."],
        ),
      ),
    ).toBe("url-verifiable");
  });

  it("still PAYS the classic reach-and-quote form (unchanged)", () => {
    expect(
      classifyVerifiability(
        m("Find the pricing page.", ["The tester reaches the pricing page and quotes the text stating the Free tier limit."]),
      ),
    ).toBe("url-verifiable");
  });

  it("HOLDS: subjective language still wins, even with artifact phrasing", () => {
    expect(
      classifyVerifiability(
        m(
          "Create your agent and tell us how the onboarding felt.",
          ["The tester provides the public URL of the created agent and describes in your own words how intuitive the flow felt."],
        ),
      ),
    ).toBe("observation-based");
  });

  it("HOLDS: a bare 'provide a url' with no created object and no text check", () => {
    expect(classifyVerifiability(m("Try the product.", ["The tester provides a url."]))).toBe("observation-based");
  });

  it("HOLDS: an account-only mission with no artifact and no page text", () => {
    expect(
      classifyVerifiability(m("Sign up for an account.", ["The tester creates an account and reports whether it worked."])),
    ).toBe("observation-based");
  });
});
