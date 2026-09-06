/**
 * PRIVY CAPS A POLICY NAME AT 50 CHARACTERS, and the mandate builder derives rule names from it
 * (`<name>:withdraw`, `<name>:stop`). A Telegram account key is a short number; a website treasury's
 * key is `web:0x…` — 43 characters — so `mandate:web:0x…` overflowed and every website treasury died
 * at creation with "Policy name must be fewer than 50 characters" (found by the founder on his phone,
 * 6 Sep 2026). The name is a label, not an identity: the binding is the wallet ↔ mandate row.
 */
export const MANDATE_NAME_MAX = 40; // leaves room for the longest derived suffix under Privy's 50

export function mandateName(accountKey: string): string {
  const full = `mandate:${accountKey}`;
  if (full.length <= MANDATE_NAME_MAX) return full;
  // keep the door prefix and the tail of the address — what a person recognises in a Privy dashboard
  return `mandate:${accountKey.slice(0, 12)}…${accountKey.slice(-6)}`;
}
