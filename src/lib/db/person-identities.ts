import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { personIdentities, type PersonIdentity, type PersonIdentityProvider } from "@/lib/db/schema";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { walletKey } from "@/lib/db/roster";
import { nowSeconds } from "./keys";

/**
 * ONE ACCOUNT, ONE PERSON (the tester door, 20 Nov 2026).
 *
 * A row says: the owner of this wallet proved, on the server, that they hold this Google, X or Telegram
 * account. It has exactly two writers, and neither takes the browser's word:
 * - the Privy exchange (`/api/auth/privy`), from the user record Privy returns for a verified token;
 * - the chat door (`recipient-submit.ts`), from the chat a chat wallet was minted for.
 *
 * A subject stays bound to the FIRST wallet that presented it. A second wallet presenting the same
 * subject is the same person, so the two are linked exactly as a repeated World ID nullifier links
 * them, and every count that reads `personWallets` (a mission's places, the cap per person, the
 * finalization watch) already treats them as one.
 */
export interface SocialAccount {
  provider: PersonIdentityProvider;
  /** the provider's own stable id for the account: Google's `sub`, X's user id, the Telegram chat id. */
  subject: string;
  /** an email or @username, for the owner's eyes only. */
  display: string | null;
}

export interface RecordedIdentity {
  /** the wallet the subject is bound to: this one, or the earlier wallet of the same person. */
  boundTo: string;
  /** true when the subject already belonged to another wallet, which is now linked to this one. */
  linked: boolean;
}

export function recordPersonIdentity(wallet: string, account: SocialAccount, now = nowSeconds()): RecordedIdentity | null {
  const subject = account.subject.trim();
  const w = wallet.trim();
  if (!subject || !w) return null;
  db.insert(personIdentities)
    .values({ provider: account.provider, subject, walletKey: walletKey(w), wallet: w, display: account.display?.trim() || null, createdAt: now })
    .onConflictDoNothing()
    .run();
  const row = db
    .select()
    .from(personIdentities)
    .where(and(eq(personIdentities.provider, account.provider), eq(personIdentities.subject, subject)))
    .get() as PersonIdentity;
  if (row.walletKey === walletKey(w)) {
    // the owner renamed the account: keep what they are shown current. The binding never moves.
    const display = account.display?.trim() || null;
    if (display && display !== row.display) {
      db.update(personIdentities).set({ display }).where(and(eq(personIdentities.provider, account.provider), eq(personIdentities.subject, subject))).run();
    }
    return { boundTo: row.wallet, linked: false };
  }
  // PERSONHOOD, not a discovery: the same account on a second wallet is one person, stated by the provider.
  linkWallets(w, row.wallet, now, "personhood");
  return { boundTo: row.wallet, linked: true };
}

/** The accounts bound to exactly this wallet (not to the rest of the person's wallets). */
export function personIdentitiesOf(wallet: string): PersonIdentity[] {
  return db.select().from(personIdentities).where(eq(personIdentities.walletKey, walletKey(wallet))).all();
}

export function hasPersonIdentity(wallet: string): boolean {
  return personIdentitiesOf(wallet).length > 0;
}

/**
 * A CHAT'S OWN WALLET IS A PERSON. A Telegram account needs a phone number, so the chat Sage minted a
 * wallet for counts as `telegram:<chatId>`. Only a private chat does (its id is the account's own,
 * a positive number); a group's id is negative and stands for nobody in particular.
 */
export function recordTelegramPerson(chatId: string, wallet: string): RecordedIdentity | null {
  if (!/^\d+$/.test(chatId.trim())) return null;
  try {
    return recordPersonIdentity(wallet, { provider: "telegram", subject: chatId.trim(), display: null });
  } catch (e) {
    console.warn("[person-identities] telegram record failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
