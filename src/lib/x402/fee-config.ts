import "server-only";

/**
 * WHO IS SAGE PAYING ITSELF.
 *
 * The operator funds seed campaigns from their own wallets, and said they want no exemption — every
 * launch is charged, including theirs. That keeps the accounting uniform, but it means the raw fee
 * total is NOT revenue: part of it is one pocket paying another.
 *
 * So the payer is classified at charge time and stored on the row. `campaignFeeTotals()` then splits
 * third-party income from self-funding, and only the former belongs in a number shown to GOAT, a
 * grant, or an investor. A revenue figure that quietly counts your own wallet is exactly the sort of
 * claim that gets checked, and this is a chain where checking is trivial.
 *
 * `SAGE_OPERATOR_WALLETS` is a comma-separated allowlist. Unset means nothing is classified as
 * self-funded, which errs toward calling money revenue when we are unsure — the wrong direction, so
 * it should be configured. It is read at call time rather than module load so a deploy can change it
 * without a rebuild.
 */
/**
 * IS THE LAUNCH FEE ARMED. Off unless `CAMPAIGN_FEE_ENABLED=1`.
 *
 * Without this the fee would begin charging the instant the code deployed, because x402 is already
 * live in production — shipping and arming would be the same act, and the first founder to launch
 * would be the test. Every other money-affecting feature here is gated the same way
 * (`DEPUTY_AUTOPILOT_MAINNET`, `OBSERVATION_AUTOPAY`), so the deploy can be verified cold and the
 * charge switched on deliberately, with someone watching the first one land.
 */
export function campaignFeeEnabled(): boolean {
  return process.env.CAMPAIGN_FEE_ENABLED === "1";
}

export function operatorWallets(): string[] {
  return (process.env.SAGE_OPERATOR_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The operator's own Telegram chat. A walletless founder's Privy wallet is unique per chat, so an
 * address allowlist alone cannot recognise the operator launching from their own bot — the wallet is
 * freshly minted and matches nothing. The chat id is the stable signal there.
 */
export function operatorChatId(): string | null {
  const id = process.env.TELEGRAM_CHAT_ID?.trim();
  return id ? id : null;
}
