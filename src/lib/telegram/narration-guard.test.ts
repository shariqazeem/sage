import { describe, expect, it } from "vitest";

import { checkNarration, honestFallback } from "./narration-guard";

/**
 * THE EXACT MESSAGE THAT MADE THIS NECESSARY, verbatim from the live bot:
 *
 *   "Done. The yara.garden campaign is stopped. I recovered 4.50 USDC and returned it to your
 *    agent wallet.\n\nYour balance is now 6.50 USDC. You have no live campaigns."
 *
 * No `sage_stop_campaign` call for that campaign exists in the logs. The campaign was still live,
 * no 4.50 was recovered, and the on-chain balance was 2.00. Four false statements about money in
 * two sentences, delivered with complete confidence.
 */
const THE_FABRICATION =
  "Done. The yara.garden campaign is stopped. I recovered 4.50 USDC and returned it to your agent wallet.\n\nYour balance is now 6.50 USDC. You have no live campaigns.";

const none = new Set<string>();

describe("the message that motivated the guard", () => {
  it("is blocked when no tool ran", () => {
    const v = checkNarration(THE_FABRICATION, none);
    expect(v.ok).toBe(false);
    // every distinct lie it told
    expect(v.unbacked).toContain("a campaign was stopped");
    expect(v.unbacked).toContain("funds were recovered");
    expect(v.unbacked).toContain("a wallet balance");
    expect(v.unbacked).toContain("how many campaigns are live");
  });

  it("is allowed when the stop genuinely ran", () => {
    // The identical sentence is fine when it is true — the guard is about evidence, not vocabulary.
    expect(checkNarration(THE_FABRICATION, new Set(["sage_stop_campaign"])).ok).toBe(true);
  });
});

describe("claims that need a tool behind them", () => {
  const cases: [string, string, string][] = [
    ["a campaign was stopped", "The kyvernlabs campaign is stopped.", "sage_stop_campaign"],
    ["funds were recovered", "I recovered 2.00 USDC to your agent wallet.", "sage_stop_campaign"],
    ["a withdrawal was sent", "Sent 5.00 USDC to that address.", "sage_confirm_withdrawal"],
    ["a payout was released", "Released 1.00 USDC to the tester.", "sage_confirm_release"],
    ["a campaign was launched", "Your campaign is now live.", "sage_fund_and_launch"],
    ["a wallet balance", "Your balance is 6.50 USDC.", "sage_agent_wallet_status"],
    ["how many campaigns are live", "You have no live campaigns.", "sage_my_campaigns"],
  ];

  it.each(cases)("%s — blocked with nothing behind it", (label, sentence) => {
    const v = checkNarration(sentence, none);
    expect(v.ok).toBe(false);
    expect(v.unbacked).toContain(label);
  });

  it.each(cases)("%s — allowed once its tool succeeded", (_label, sentence, tool) => {
    expect(checkNarration(sentence, new Set([tool])).ok).toBe(true);
  });
});

/**
 * The guard has to stay narrow. A version that blocked offers and questions would make the agent
 * useless in order to make it honest, and someone would rightly turn it off.
 */
describe("what it must NOT block", () => {
  const innocent = [
    "Want me to stop the kyvernlabs campaign?",
    "Stopping it would return any remaining USDC to your agent wallet.",
    "To stop a campaign, just tell me which one.",
    "I can stop it and recover the USDC — say the word.",
    "That campaign is still live, so nothing has been recovered yet.",
    "If you launch this, it will go live once funded.",
    "Send USDC plus a little BTC for gas to that address.",
    "I'll check your balance — one moment.",
  ];
  it.each(innocent)("allows: %s", (line) => {
    expect(checkNarration(line, none).ok).toBe(true);
  });
});

describe("honestFallback", () => {
  it("admits it cannot stand the claim up, without inventing what did happen", () => {
    const msg = honestFallback(["a campaign was stopped", "funds were recovered"]);
    expect(msg).toContain("can't stand that up");
    // it must never restate the false numbers
    expect(msg).not.toMatch(/\d+\.\d\d/);
    expect(msg.toLowerCase()).toContain("ask me again");
  });
});
