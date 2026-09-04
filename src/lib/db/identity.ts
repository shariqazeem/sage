import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { identityProofs, type IdentityProof } from "@/lib/db/schema";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { walletKey } from "@/lib/db/roster";

/**
 * Recording a proof does two things, and the second one is the point.
 *
 * It marks this wallet as backed by a distinct person — and it checks whether that person has
 * already proved from another wallet. A nullifier is stable per person, so a repeat is not a
 * coincidence and not an attack we have to infer from gas patterns: it is the same human, stated by
 * the provider. Those wallets are LINKED immediately, which is the same signal the consolidation
 * watch produces from the chain, so every gate that already holds a linked cluster holds these too.
 *
 * The farm that took ten of ten slots would have needed ten different people to pass this.
 */
export interface RecordOutcome {
  proof: IdentityProof;
  /** wallets already verified by the SAME person — empty for an honest first verification. */
  alsoTheirs: string[];
}

export function recordIdentityProof(input: { wallet: string; provider: string; nullifier: string; level: string | null }, now = Math.floor(Date.now() / 1000)): RecordOutcome {
  const key = walletKey(input.wallet);
  const priors = db
    .select()
    .from(identityProofs)
    .where(and(eq(identityProofs.provider, input.provider), eq(identityProofs.nullifier, input.nullifier)))
    .all();

  const existing = db
    .select()
    .from(identityProofs)
    .where(and(eq(identityProofs.walletKey, key), eq(identityProofs.provider, input.provider)))
    .get();

  if (existing) {
    db.update(identityProofs).set({ nullifier: input.nullifier, level: input.level, verifiedAt: now }).where(eq(identityProofs.id, existing.id)).run();
  } else {
    db.insert(identityProofs).values({ id: `idp_${randomUUID().slice(0, 12)}`, walletKey: key, wallet: input.wallet.trim(), provider: input.provider, nullifier: input.nullifier, level: input.level, verifiedAt: now }).run();
  }

  // one person, several wallets → link them, exactly as an on-chain forward would
  const alsoTheirs = priors.map((p) => p.wallet).filter((w) => walletKey(w) !== key);
  // PERSONHOOD, not a discovery: the same verified nullifier on a second wallet is proof they are
  // one person, which is the point of verifying — never evidence against them.
  for (const other of alsoTheirs) linkWallets(input.wallet, other, now, "personhood");

  const proof = db.select().from(identityProofs).where(and(eq(identityProofs.walletKey, key), eq(identityProofs.provider, input.provider))).get() as IdentityProof;
  return { proof, alsoTheirs };
}

export function identityFor(wallet: string): IdentityProof | null {
  return db.select().from(identityProofs).where(eq(identityProofs.walletKey, walletKey(wallet))).get() ?? null;
}

export function identityCount(): { people: number; wallets: number } {
  const all = db.select().from(identityProofs).all();
  return { people: new Set(all.map((r) => `${r.provider}:${r.nullifier}`)).size, wallets: all.length };
}
