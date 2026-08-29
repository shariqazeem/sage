/**
 * THE PRIVATE DOOR — action lists for collecting a Sage payout into a shielded note.
 *
 * The STRK20 pool cannot be driven by a server. Every shielded operation goes through the
 * wallet's `strk20InvokeTransaction`, because the wallet holds the viewing key and reaches the
 * proving service. So this module builds the action list and the browser hands it over; nothing
 * here signs, submits, or touches a key.
 *
 * WHAT THE POOL DOES WITH IT. The `transfer` leg opens an empty note for the recipient. The
 * `invoke` leg calls `privacy_invoke` on SageClaims, which flips the claim to collected, approves
 * the pool for exactly that amount, and returns the deposit record the pool then fills the note
 * from. The chain shows a collection joined to a deposit only by a hash nobody can invert.
 *
 * THE PAYLOAD RULES ARE NOT NEGOTIABLE and cost other teams days to establish:
 *
 *   1. Felts go to the wallet as MINIMAL hex — `0x1`, never `0x00…01`. Zero-padding is itself
 *      rejected with INVALID_REQUEST_PAYLOAD (114).
 *   2. An `invoke` must be accompanied by a `transfer` or `withdraw` leg.
 *   3. The OPEN note is opened in the token the helper RETURNS, not one it consumes.
 *   4. `${openNoteIds[0]}` passes through untouched — the wallet substitutes it.
 *
 * Calldata order is the signature's order: the pool deserializes it straight into
 * `privacy_invoke(operation, secret, note_id)`. One field out of place is a revert with no message.
 */

/** `PrivateExit` in claims.cairo. Cairo enums serialize as their variant index. */
export const EXIT = {
  claim: "0x0",
  refund: "0x1",
} as const;

/** The wallet substitutes this with the id of the note opened by the transfer leg. */
export const OPEN_NOTE_PLACEHOLDER = "${openNoteIds[0]}";

export interface Strk20Action {
  type: "transfer" | "withdraw" | "invoke";
  token?: string;
  amount?: string;
  recipient?: string;
  contract?: string;
  calldata?: string[];
}

/**
 * Minimal hex, with no zero padding and no `0x` duplication.
 *
 * A padded felt is rejected while the identical value unpadded is accepted, and a "fix" that adds
 * padding is the classic way to cause the error it appears to address.
 */
export function felt(value: string | bigint | number): string {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < BigInt(0)) throw new Error("a felt cannot be negative");
  return `0x${n.toString(16)}`;
}

export interface ClaimToNoteInput {
  /** The deployed SageClaims contract. */
  claims: string;
  /** The settlement token — must be the one the claim was escrowed in. */
  token: string;
  /** The claim preimage. Whoever holds it owns the money. */
  secret: string;
  /** Where the opened note belongs — the collector's own address. */
  recipient: string;
}

/**
 * Collect into a shielded note.
 *
 * `amount: "OPEN"` is the pool's own marker for "a note whose value is filled by what the helper
 * returns". It is a literal, not a number we are declining to compute.
 */
export function buildClaimToNoteActions(input: ClaimToNoteInput): Strk20Action[] {
  return [
    {
      type: "transfer",
      token: felt(input.token),
      amount: "OPEN",
      recipient: felt(input.recipient),
    },
    {
      type: "invoke",
      contract: felt(input.claims),
      calldata: [EXIT.claim, felt(input.secret), OPEN_NOTE_PLACEHOLDER],
    },
  ];
}

/**
 * Pull an expired, uncollected payout back into the funder's own shielded note.
 *
 * Same shape as a collection because it is the same operation from the contract's side — the only
 * differences are which preimage authorises it and that the expiry must have passed.
 */
export function buildRefundToNoteActions(input: ClaimToNoteInput): Strk20Action[] {
  return [
    {
      type: "transfer",
      token: felt(input.token),
      amount: "OPEN",
      recipient: felt(input.recipient),
    },
    {
      type: "invoke",
      contract: felt(input.claims),
      calldata: [EXIT.refund, felt(input.secret), OPEN_NOTE_PLACEHOLDER],
    },
  ];
}
