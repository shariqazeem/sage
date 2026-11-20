import type { SocialAccount } from "@/lib/db/person-identities";

/** The two fields of Privy's user record the tester door reads. Structural, so this file stays pure. */
export interface PrivySocialFields {
  google?: { subject: string; email: string | null } | null;
  twitter?: { subject: string; username: string | null } | null;
}

/**
 * The Google and X accounts PRIVY says this user holds. Read from the user record Privy returns for a
 * verified token, never from anything the browser sent: this is what the tester door counts as a person
 * (`person_identities`). Privy gives the provider's stable id (`subject`) and a label. It does not give
 * an account's age, followers or activity.
 */
export function socialAccountsOf(user: PrivySocialFields): SocialAccount[] {
  const out: SocialAccount[] = [];
  const g = user.google;
  if (g?.subject) out.push({ provider: "google", subject: g.subject, display: g.email || null });
  const t = user.twitter;
  if (t?.subject) out.push({ provider: "x", subject: t.subject, display: t.username ? `@${t.username}` : null });
  return out;
}
