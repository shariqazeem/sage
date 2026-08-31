/**
 * The exact message a wallet must sign to change its record's privacy setting.
 *
 * POST /api/record/<wallet>/privacy — a worker turns payout amounts on or off on their own record.
 * Only the wallet whose income it is may change this, so the choice is signed. Without that, anyone
 * could switch someone else's record public — which for a person who deliberately turned it off
 * would publish their income against their wishes, the exact harm the setting exists to prevent.
 * The signature covers the DIRECTION as well as the wallet and the time, so a signature obtained
 * for one change cannot be replayed to make the opposite one.
 *
 * It lives here rather than in the route because a Next route file may only export handlers and
 * route config; an extra named export makes the module fail Next's own route contract. It builds
 * today only because the project passes `--turbopack`, which does not enforce that rule, and would
 * break the moment the flag changed. Same reason as attestation-challenge.ts.
 */
export function privacyChallenge(wallet: string, amountsPrivate: boolean, issuedAt: number): string {
  return [
    "Sage record privacy",
    `wallet: ${wallet.toLowerCase()}`,
    `amounts: ${amountsPrivate ? "private" : "public"}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}
