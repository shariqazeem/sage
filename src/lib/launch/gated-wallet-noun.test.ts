import { describe, expect, it } from "vitest";

import { detectGatedActions } from "./gated-action-mission";

/**
 * A WALLET NOUN IS NOT A WALLET ACTION.
 *
 * Measured live on starkscan.co, goal: "make sure someone can look up a wallet address and see its
 * token balances". "wallet" there is a LOOKUP TARGET, and the founder asked nobody to connect
 * anything — but the family pattern accepted the bare word, so a GATED wallet mission was built
 * for a public block explorer with no wallet step, no login and no gate. A task no tester could
 * complete, holding half of a $1 budget.
 *
 * The account family already required a verb ("sign up", "create an account") rather than the noun
 * "account". This pins the same rule for wallets, in both directions — because the families that
 * must never be INVENTED are exactly the ones that must still be PLANNED when genuinely asked for.
 */

// Lines Sage "observed" — the anchor a gated mission must cite. Generous on purpose: the test is
// about the founder's WORDS qualifying, not about whether a gate was visible.
const OBSERVED = [
  "Connect Wallet",
  "Sign transaction",
  "Wallet address",
  "Token balances",
  "MetaMask",
  // A gated mission must cite a doorway Sage actually saw, so the control-family cases need one
  // too — otherwise they fail for a missing anchor rather than for the pattern under test.
  "Sign up for free",  // >= 8 chars: findGateAnchor ignores anything shorter
  "Buy credits",
];

const families = (goal: string) => detectGatedActions(goal, OBSERVED).map((a) => a.family);

describe("a wallet MENTION does not create a gated wallet mission", () => {
  it("does not fire on the goal that produced the defect", () => {
    expect(
      families("make sure someone can look up a wallet address and see its token balances"),
    ).not.toContain("wallet");
  });

  it("does not fire on other lookup phrasings", () => {
    for (const goal of [
      "check that wallet balances render correctly",
      "users should be able to search any wallet address",
      "show me the wallet page loads fast",
      "verify the wallet address column is not truncated",
    ]) {
      expect(families(goal), goal).not.toContain("wallet");
    }
  });
});

describe("a wallet ACTION still creates one — the point of the feature", () => {
  it("fires when the founder asks a tester to connect a wallet", () => {
    for (const goal of [
      "testers must connect their wallet to continue",
      "have them connect a wallet and see the dashboard",
      "the tester should link their wallet",
      "check someone can fund their wallet in the app",
    ]) {
      expect(families(goal), goal).toContain("wallet");
    }
  });

  it("fires on signing a transaction, which only a person can do", () => {
    expect(families("the tester signs the transaction to mint")).toContain("wallet");
    expect(families("they need to sign a transaction with their own key")).toContain("wallet");
  });

  it("fires on using MetaMask specifically, not on naming it in passing", () => {
    expect(families("let them pay with MetaMask")).toContain("wallet");
    expect(families("our docs page mentions MetaMask compatibility")).not.toContain("wallet");
  });
});

describe("the other families are unaffected", () => {
  it("still detects an account gate the founder asked for", () => {
    expect(families("testers must sign up before they can post")).toContain("account");
  });

  it("still detects a payment gate", () => {
    expect(families("they have to buy credits to launch an agent")).toContain("payment");
  });
});
