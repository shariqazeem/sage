/**
 * WHAT MUST BE TRUE BEFORE THE AGENT SPENDS FROM THE TREASURY. Pure, so the web route and the
 * Telegram tool cannot disagree, and so each refusal is a sentence the founder can act on.
 */
export type TreasuryPreflight =
  | { ok: true }
  | { ok: false; reason: "overCap" | "needsFunding" | "needsGas"; message: string };

const usd = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;

export function treasuryPreflight(input: { budgetBase: bigint; capBase: bigint; balanceBase: bigint; gasWei: bigint; minGasWei: bigint; address: string }): TreasuryPreflight {
  if (input.budgetBase > input.capBase) {
    return { ok: false, reason: "overCap", message: `This campaign's budget is ${usd(input.budgetBase)}; the treasury's per-campaign cap is ${usd(input.capBase)}. Lower the budget or raise the cap.` };
  }
  if (input.balanceBase < input.budgetBase) {
    return { ok: false, reason: "needsFunding", message: `The treasury holds ${usd(input.balanceBase)} USDC and this campaign needs ${usd(input.budgetBase)}. Send USDC on GOAT to ${input.address}.` };
  }
  if (input.gasWei < input.minGasWei) {
    return { ok: false, reason: "needsGas", message: `The treasury needs a little native BTC for gas on GOAT (about 0.00001 BTC) at ${input.address}.` };
  }
  return { ok: true };
}
