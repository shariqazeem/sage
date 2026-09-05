import { describe, expect, it } from "vitest";
import { releasesOnThirdPartyDecision } from "./third-party-decision";

/**
 * The rule is about DECISIONS someone else makes about the recipient — a bank approving a loan, an
 * employer hiring, a client accepting — never about business activity the recipient can show.
 * P-DIRECT 7 (2026-09-05) refused "first confirmed booking"; that is a customer booking, evidence of
 * trade, and the founder's own catering-grant fixture.
 */
describe("releasesOnThirdPartyDecision", () => {
  it("names the decisions", () => {
    for (const t of [
      "Send my cousin $200 when the bank finally approves her loan application.",
      "pay my nephew $50 when he gets the job at the port",
      "give her $100 once her visa is approved",
      "$30 when the client accepts the design",
      "Dale $200 a mi prima cuando el banco apruebe el préstamo",
      "The bank has approved the loan",
    ]) expect(releasesOnThirdPartyDecision(t), t).toBe(true);
  });

  it("leaves business activity and public artifacts alone", () => {
    for (const t of [
      "First confirmed booking",
      "The customer's booking confirmation is posted publicly with the wallet address on the page",
      "she posts her first customer review",
      "release $60 when the delivery confirmation for invoice INV-1042 is public",
      "publish the confirmed order page",
      "when the new logo page is live on my site",
      "half when she publishes her catalogue online and half when she posts her first customer review",
    ]) expect(releasesOnThirdPartyDecision(t), t).toBe(false);
  });
});
