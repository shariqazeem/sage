import type { SettlementRail } from "@/lib/db/schema";

/**
 * WHICH RAIL PAYS A CAMPAIGN OUT — decided by Sage, never asked of a founder.
 *
 * A founder is hiring testing, not selecting infrastructure. "GOAT or Starknet?" is a form field
 * about something they cannot evaluate, and this product's standing principle is to never ask them
 * anything Sage can work out itself. So the rail is derived, and the thing it derives from is the
 * only question that actually matters:
 *
 *   WHOSE MONEY IS IT?
 *
 * · A FOUNDER-FUNDED campaign settles on the EVM rail, from a CampaignVault the founder owns.
 *   Sage can ask that vault to release a reward and can never withdraw from it. That guarantee —
 *   "the budget lives in a contract you own" — is the sentence this whole product rests on, and it
 *   is not worth trading for a better exit.
 *
 * · A SAGE-FUNDED campaign settles on Starknet, paid directly from Sage's own account. There is no
 *   vault, so there is no custody guarantee to lose: the money was Sage's already. What the
 *   recipient gains is an asset they can actually move — the exit problem the first cohort hit,
 *   where people were paid and then could not get the money out.
 *
 * The honest cost of the Starknet rail, stated so nobody has to discover it: with no vault, Sage's
 * own key is the limit, so the balance it holds IS the cap. That is acceptable for Sage's money
 * and would not be for a founder's.
 */
export interface RailInputs {
  /** true when Sage owns and funds the campaign, rather than a founder. */
  ownerIsSage: boolean;
  /** false when the Starknet deployment is not configured — then there is no second rail. */
  starknetAvailable: boolean;
  /**
   * Whether this campaign collects Starknet addresses from its testers.
   *
   * THIS IS NOT A FORMALITY AND IT IS WHY THE RAIL IS NOT SIMPLY "SAGE'S MONEY GOES TO STARKNET".
   * A Starknet payout needs a Starknet address, and every tester today submits an EVM one. Flipping
   * the rail on ownership alone would leave `settleOnStarknet` correctly refusing every payout with
   * "recipient is not a Starknet address" — turning working campaigns into a queue of held work and
   * unpaid people. A rail is only usable when the recipients on it can actually be paid.
   */
  recipientsOnStarknet: boolean;
}

export function resolveSettlementRail(input: RailInputs): SettlementRail {
  // A founder's money stays in a contract the founder owns. No exception, including when the
  // Starknet rail would give their testers a better exit — that is their call to make later, not
  // one to take from them at creation.
  if (!input.ownerIsSage) return "evm";

  // Sage's own money goes where the recipient can actually spend it — but only when there is a
  // configured deployment AND the people being paid can receive on it. A working rail beats a
  // better one; an unpayable rail is not a rail.
  return input.starknetAvailable && input.recipientsOnStarknet ? "starknet" : "evm";
}

/** One sentence explaining the choice, for the launch feed and the campaign record. */
export function railRationale(rail: SettlementRail, input: RailInputs): string {
  if (rail === "evm" && !input.ownerIsSage) {
    return "Settling from the vault you own — Sage can release rewards from it and can never withdraw.";
  }
  if (rail === "evm" && !input.starknetAvailable) {
    return "Settling on the EVM rail; the Starknet deployment is not configured.";
  }
  if (rail === "evm") {
    return "Settling on the EVM rail; this campaign's testers are paid to EVM addresses.";
  }
  return "Settling on Starknet, so testers receive an asset they can actually move.";
}
