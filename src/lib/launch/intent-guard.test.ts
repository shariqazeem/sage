import { describe, it, expect } from "vitest";
import { guardGoalAgainstFounder } from "./intent-guard";

/**
 * REGRESSION — production job AYEs2F0uKgiG. The founder wrote:
 *
 *   "Test my product https://sagepays.xyz , make users launch campaign, funding campaign not
 *    requires , my budget is 50$"
 *
 * and the agent expanded it into "navigate the site, CONNECT THEIR WALLET, and successfully
 * initiate the creation of a testing campaign". Sage explored 12 states across /, /dashboard and
 * /launch — it reached everything it needed — but four of six checkpoints now hinged on connecting
 * a wallet, which Sage cannot do and must not. The run stalled and asked the founder to restate the
 * goal they had already given.
 *
 * A rephrasing may describe the same work in other words. It may not introduce a gated action the
 * founder never asked for, or one they explicitly ruled out.
 */

const FOUNDER =
  "Test my product https://sagepays.xyz , make users launch campaign, funding campaign not requires , my budget is 50$";

describe("the exact failure", () => {
  const EXPANDED =
    "Have testers navigate the site, connect their wallet, and successfully initiate the creation of a testing campaign";

  it("drops the invented wallet requirement", () => {
    const r = guardGoalAgainstFounder(FOUNDER, EXPANDED);
    expect(r.goal).not.toMatch(/wallet/i);
    expect(r.dropped).toContain("wallet");
  });

  it("keeps everything the founder DID ask for", () => {
    const r = guardGoalAgainstFounder(FOUNDER, EXPANDED);
    expect(r.goal).toMatch(/navigate the site/i);
    expect(r.goal).toMatch(/creation of a testing campaign/i);
  });

  it("'funding not requires' stays a hard exclusion", () => {
    const r = guardGoalAgainstFounder(
      FOUNDER,
      "create a campaign, fund the campaign, and confirm it went live",
    );
    expect(r.goal).not.toMatch(/\bfund\b/i);
    expect(r.dropped).toContain("payment");
  });
});

describe("it removes invention, never intent", () => {
  it("leaves a faithful expansion completely untouched", () => {
    const faithful =
      "Have testers open the site, go to the launch page, and reach the generated plan screen";
    const r = guardGoalAgainstFounder(FOUNDER, faithful);
    expect(r.goal).toBe(faithful);
    expect(r.dropped).toEqual([]);
  });

  it("KEEPS a gated step the founder actually asked for", () => {
    const r = guardGoalAgainstFounder(
      "make users sign up and then create a project",
      "have testers sign up for an account, then create a project",
    );
    expect(r.goal).toMatch(/sign up/i);
    expect(r.dropped).toEqual([]);
  });

  it("keeps a wallet step when the founder's product is about wallets", () => {
    const r = guardGoalAgainstFounder(
      "test that users can connect their wallet and see their balance",
      "have testers connect their wallet, then confirm the balance is displayed",
    );
    expect(r.goal).toMatch(/wallet/i);
    expect(r.dropped).toEqual([]);
  });

  it("never returns an empty goal — a wide goal beats refusing to plan", () => {
    const r = guardGoalAgainstFounder("just look at my landing page", "connect the wallet");
    expect(r.goal).toBe("connect the wallet");
    expect(r.dropped).toEqual([]);
  });

  it("leaves the goal alone when there is nothing to compare against", () => {
    for (const f of ["", null, undefined]) {
      const r = guardGoalAgainstFounder(f, "connect a wallet, then do the thing");
      expect(r.goal).toBe("connect a wallet, then do the thing");
    }
  });
});

describe("the exclusion shapes founders actually write", () => {
  it.each([
    ["funding not required", "payment"],
    ["without logging in", "account"],
    ["don't connect a wallet", "wallet"],
    ["no need to pay", "payment"],
    ["skip the signup", "account"],
  ])("%s is honoured", (phrase, family) => {
    const r = guardGoalAgainstFounder(
      `test the product, ${phrase}`,
      "do the thing, connect a wallet, log in, and pay for it",
    );
    expect(r.dropped).toContain(family);
  });
});

describe("a real access wall is still a real question", () => {
  it("an invented login is dropped, so only a GENUINE product wall can ask", () => {
    // the founder said nothing about accounts — an invented "log in" step must not become the
    // reason Sage stalls. If the product truly gates on login, the browser discovers that itself.
    const r = guardGoalAgainstFounder(
      "make users read the docs and try the quickstart",
      "log in to the site, read the docs, and run the quickstart",
    );
    expect(r.goal).not.toMatch(/log in/i);
    expect(r.goal).toMatch(/quickstart/i);
  });
});
