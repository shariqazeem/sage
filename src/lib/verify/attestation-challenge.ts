/**
 * The exact message a requester must sign to ask about a wallet's earnings floor.
 *
 * Explicit so a wallet UI can show what is being agreed, and covering the FLOOR as well as the
 * wallet — otherwise one signature could be replayed across every floor and the threshold endpoint
 * becomes the oracle the redaction exists to prevent. Ask about $500, then $250, then $375, and in
 * about twenty requests you have reconstructed the income the record was redacted to protect. Same
 * failure the no-corpus-oracle rule refuses elsewhere: a yes/no you can ask repeatedly is a readout.
 *
 * It lives here rather than in the route because a Next route file may only export handlers and
 * route config. An extra named export makes the module fail Next's own route contract — it builds
 * today only because the project passes `--turbopack`, which does not enforce it, and would break
 * the moment that flag changed. Caught 2026-08-31 by running the webpack build by accident.
 */
export function attestationChallenge(
  wallet: string,
  floorUsd: number | null,
  issuedAt: number,
): string {
  return [
    "Sage earnings attestation",
    `wallet: ${wallet.toLowerCase()}`,
    floorUsd === null ? "floor: none" : `floor: at least $${floorUsd.toFixed(2)}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}
