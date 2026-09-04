/**
 * THE DOOR — one person, one slot, on public work.
 *
 * The first gate keyed on what a mission PAYS: work at or under a ceiling was open to any fresh
 * wallet, and only the rare better-paid mission asked for a record. The founder's objection was
 * exact — "$50 with 50 slots can be farmed" — because every one of those slots sits under the
 * ceiling, and the farm that actually happened (ten of ten slots at $1.10 to one operator with
 * twelve wallets) would pass that gate untouched today.
 *
 * So the door keys on the PERSON. On public work, claiming asks for a one-time personhood proof
 * (a World ID nullifier — no name, no document, no country), and the slot cap counts people, not
 * wallets. Fifty slots need fifty humans. A wallet is free; a person is not. Members-only work is
 * untouched: the organisation chose its people and can vouch for them.
 *
 * Armed by `IDENTITY_DOOR=1`. The older reward-tier rule (`IDENTITY_TIERS`) is bypassed when the
 * door is armed — two gates with different theories of who may pass would contradict each other in
 * the one place a person reads the answer.
 */
export function identityDoorArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.IDENTITY_DOOR === "1";
}

/** What a person is told at the door. It is an invitation with a reason, never a dead end. */
export const PERSONHOOD_DOOR_COPY =
  "This board asks everyone to prove they are one person, once. No name, no document, no country — about a minute, and every public mission is open to you from then on.";

/** What a person is told when their one slot on this work is already taken — by any of their wallets. */
export function alreadyClaimedCopy(scope: "mission" | "campaign"): string {
  return scope === "mission"
    ? "You've already claimed this one. One slot per person on public work — other missions are still open to you."
    : "You've been paid the most this campaign allows per person. Other campaigns on the board are still open to you.";
}
