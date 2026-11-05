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
      "pay him when he is hired by the agency",
      "release the grant once my sister is admitted",
      "$50 when the application was accepted",
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
      // a QA check the worker can show: a promo code accepted at a checkout is not anyone's decision about them
      "Confirms whether code TESTDRIVE was accepted and what the discount showed at checkout",
      "note whether the card payment was approved in the test checkout",
      // Sage Bench, 5 Nov 2026: steps of real work, not anyone's decision about the worker
      "either a short audit from a firm, or a public review by two reviewers the founder approves",
      "1. Get the contract's source code and address from the founder, and confirm the exact version",
      "The claim transaction is confirmed on Metis Sepolia and credits LUME test rewards to the wallet",
      "States explicitly whether shared-memory bank conflicts and suboptimal tiling are confirmed or ruled out",
      // Sage Bench r5, 5 Nov 2026: a pre-work step, a public merge, and a smart contract's details
      "Use two reviewers Northgate approves (ask Hana Sato, programme manager, to approve them before you start).",
      "Abre un pull request. Sage paga cuando los mantenedores lo acepten (merge).",
      "1. Get the contract details from the founder: the address and the network.",
    ]) expect(releasesOnThirdPartyDecision(t), t).toBe(false);
  });

  it("still refuses a private decision that sits next to a merge or a start", () => {
    for (const t of [
      "Pay her once the bank approves the loan, then open a pull request with the receipt",
      "Dale $100 cuando el banco lo acepte; los mantenedores harán merge del PR",
      "pay him when the client accepts the design",
      "release it when my client signs off on the final logo",
    ]) expect(releasesOnThirdPartyDecision(t), t).toBe(true);
  });
});
