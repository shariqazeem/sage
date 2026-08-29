import { hash, shortString } from "starknet";

/**
 * CLAIM LINKS — addressing money to a person instead of to a wallet.
 *
 * Sage's payouts have always landed on an address, which quietly requires the worker to have
 * become a crypto user before they are allowed to be paid: a wallet at payout time, gas to move
 * what they were paid, and a venue that lists the chain. The first cohort proved what that costs —
 * people were paid and then could not get the money out.
 *
 * A claim link inverts it. Sage escrows the payout behind a Poseidon commitment, and the worker
 * names where it lands at the moment they collect. The commitment commits to nobody, so the
 * recipient does not need to exist yet; and collection is authorised by the preimage rather than by
 * the caller, so Sage can pay the gas for someone holding no token at all.
 *
 * ISOMORPHIC ON PURPOSE. The claim page derives the commitment in the browser so it can show a
 * worker whether their link is real and uncollected without transmitting the secret anywhere —
 * including to Sage. That only works if the same derivation runs on both sides, so this module
 * uses Web Crypto (present in Node 18+ and every browser) rather than `node:crypto`.
 *
 * THE COMMITMENT MUST MATCH THE CONTRACT EXACTLY. This module derives in TypeScript what
 * `contracts-starknet/src/claims.cairo` derives in Cairo, and a one-bit disagreement escrows real
 * money to a commitment whose preimage does not open it — silent at deposit time and permanent
 * afterwards. Both sides assert the same pinned vectors; see `claim-link.test.ts`.
 */

/** Domain tags. Must be byte-identical to `CLAIM_TAG` / `REFUND_TAG` in claims.cairo. */
const CLAIM_TAG = "SAGE_CLAIM:V1";
const REFUND_TAG = "SAGE_REFUND:V1";

/**
 * Secret width.
 *
 * A felt252 is bounded by the STARK prime (just over 2^251), so a full-width random draw would
 * sometimes exceed it and need rejection or reduction — both of which are easy to get subtly wrong
 * in a way that biases the distribution. Drawing 31 bytes is unconditionally in range and still
 * leaves 248 bits of entropy, which is not a number anyone searches.
 */
const SECRET_BYTES = 31;

export interface ClaimSecrets {
  /** Held by the worker. Whoever has it owns the money. */
  claimSecret: string;
  /** Held by Sage. Opens the way back only after the claim expires. */
  refundSecret: string;
  /** What goes on-chain in place of the worker's identity. */
  claimCommitment: string;
  refundCommitment: string;
}

/** A cryptographically random felt, as a 0x-prefixed hex string. */
export function generateSecret(rng: (n: number) => Uint8Array = randomBytesWeb): string {
  return `0x${Array.from(rng(SECRET_BYTES), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function randomBytesWeb(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Never `Math.random()` — a predictable secret is a payout anyone can take.
  globalThis.crypto.getRandomValues(out);
  return out;
}

const feltOf = (secret: string): string =>
  secret.startsWith("0x") ? secret : shortString.encodeShortString(secret);

const commit = (tag: string, secret: string): string =>
  BigInt(
    hash.computePoseidonHashOnElements([shortString.encodeShortString(tag), feltOf(secret)]),
  ).toString();

/** `poseidon(CLAIM_TAG, secret)` — the key the money is escrowed under. */
export const claimCommitment = (secret: string): string => commit(CLAIM_TAG, secret);

/** `poseidon(REFUND_TAG, secret)` — a different domain, so one preimage never opens both doors. */
export const refundCommitment = (secret: string): string => commit(REFUND_TAG, secret);

/** A fresh pair of secrets and the two commitments that go on-chain. */
export function mintClaimSecrets(rng?: (n: number) => Buffer): ClaimSecrets {
  const claimSecret = generateSecret(rng);
  const refundSecret = generateSecret(rng);
  return {
    claimSecret,
    refundSecret,
    claimCommitment: claimCommitment(claimSecret),
    refundCommitment: refundCommitment(refundSecret),
  };
}

/**
 * The link a worker receives.
 *
 * The secret rides in the URL FRAGMENT, which browsers do not send to the server. Sage's own web
 * server therefore never receives it in a request line, never writes it to an access log, and
 * cannot leak it through a referrer header. The claim page reads it client-side and submits only
 * the resulting transaction.
 */
export function claimUrl(origin: string, claimSecret: string): string {
  return `${origin.replace(/\/+$/, "")}/claim#${claimSecret}`;
}

/** Read a secret back out of a claim URL, or null when there is none. */
export function secretFromUrl(url: string): string | null {
  const frag = url.split("#")[1]?.trim();
  return frag && /^0x[0-9a-fA-F]+$/.test(frag) ? frag : null;
}
