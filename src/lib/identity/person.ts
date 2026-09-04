import "server-only";
import { nullifierFor, walletsForNullifier } from "@/lib/db/identity";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";

/**
 * EVERY WALLET THAT IS THIS PERSON.
 *
 * Three sources, each already recorded for its own reason: the wallets carrying the same personhood
 * nullifier (the provider says they are one human), the wallets the consolidation watch linked from
 * on-chain forwards (the chain says so), and the wallets the person declared as theirs (they said so
 * and proved both). For counting slots they are all the same answer — one person — and none of them
 * is an accusation here: the cap is not a punishment, it is the definition of "one slot each".
 *
 * Always includes the wallet itself. Spellings are returned as stored; compare with `sameChainAddress`
 * or a bare-hex key, never with `===`.
 */
export function personWallets(wallet: string): string[] {
  const out = new Map<string, string>();
  const add = (w: string) => {
    const k = w.trim().toLowerCase().replace(/^0x0*/, "0x");
    if (!out.has(k)) out.set(k, w);
  };
  add(wallet);
  const id = nullifierFor(wallet);
  if (id) for (const w of walletsForNullifier(id.provider, id.nullifier)) add(w);
  for (const w of linkedWalletsOf(wallet)) add(w);
  return [...out.values()];
}

/** Only the wallets a PERSONHOOD PROOF says are this person — the subset a reason may name as such. */
export function sameNullifierWallets(wallet: string): string[] {
  const id = nullifierFor(wallet);
  return id ? walletsForNullifier(id.provider, id.nullifier) : [];
}
