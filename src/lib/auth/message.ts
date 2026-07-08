/**
 * The exact human-readable message a wallet signs to prove control of an
 * address. Pure and shared: the client builds it to sign, the server rebuilds it
 * byte-for-byte to verify. Any drift here breaks auth, so it lives in one place.
 *
 * This is SIWE-lite — it proves wallet control for a session. It is NOT a
 * transaction and authorizes no spend; the copy says so, because the user reads
 * it in their wallet.
 */
export function buildSiweMessage(args: {
  address: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    "Sage — sign in",
    "",
    `Wallet: ${args.address}`,
    `Nonce: ${args.nonce}`,
    `Issued At: ${args.issuedAt}`,
    "",
    "Signing proves you control this wallet. It authorizes no transaction and moves no funds.",
  ].join("\n");
}

export const NONCE_COOKIE = "sage_nonce";
export const SESSION_COOKIE = "sage_session";
