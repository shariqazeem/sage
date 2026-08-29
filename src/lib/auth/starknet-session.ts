import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { RpcProvider, verifyMessageInStarknet } from "starknet";

import { starknetAddresses } from "@/lib/starknet/config";

/**
 * STARKNET SIGN-IN — the same guarantee as the EVM session, on a different curve.
 *
 * The property that matters is not "the user is logged in", it is: A PAYOUT CAN ONLY EVER REACH AN
 * ADDRESS THAT PROVED CONTROL OF ITSELF. The EVM path enforces that by taking the payout address
 * from the SIWE session rather than from the submit form, so nobody can do the work and direct the
 * money elsewhere. Starknet settlement needs the identical property or it is strictly weaker, and
 * the whole point of moving people onto it is that they end up better off, not less protected.
 *
 * DELIBERATELY SEPARATE FROM session.ts, NOT A REFACTOR OF IT. The two produce different address
 * shapes — a checksummed 20-byte EVM address versus a felt of up to 64 hex digits — and viem's
 * `getAddress` rejects the latter outright. Folding both into one session would mean touching the
 * live auth path of a product that moves real money, to save perhaps fifteen lines. The token
 * format and secret are shared by construction; the cookie and the address space are not.
 *
 * VERIFICATION GOES THROUGH THE ACCOUNT CONTRACT. Starknet accounts are contracts, so a signature
 * is valid if the account says it is — `is_valid_signature`, reached here via
 * `verifyMessageInStarknet`. There is no recover-the-pubkey shortcut and looking for one would
 * silently exclude every smart account, which on Starknet is all of them.
 */

const NONCE_COOKIE = "sage_stark_nonce";
const SESSION_COOKIE = "sage_stark_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NONCE_TTL_S = 10 * 60;
/** How stale a signature may be. Bounds replay to a short window even with a live nonce. */
const ISSUED_AT_WINDOW_MS = 10 * 60 * 1000;

function sessionSecret(): string {
  const s = process.env.SAGE_SESSION_SECRET?.trim();
  if (!s) throw new Error("SAGE_SESSION_SECRET is not set");
  return s;
}

const b64url = (i: string) => Buffer.from(i).toString("base64url");
const unb64url = (i: string) => Buffer.from(i, "base64url").toString();
const hmac = (payload: string) =>
  createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * A Starknet address is a felt. Normalised to lowercase with no leading zeros.
 *
 * Zeros are stripped BEFORE the width is checked, not after. Addresses are commonly written padded
 * to 32 bytes and sometimes further, so validating the raw width first rejects the very form most
 * tools emit — and since the payout address is taken from this, rejecting it would mean refusing to
 * pay someone whose address was merely written the usual way.
 */
export function normalizeStarknetAddress(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(t)) return null;
  const stripped = t.slice(2).replace(/^0+/, "");
  // A felt is below 2^252, so 63 significant hex digits is the ceiling once padding is gone.
  if (!stripped || stripped.length > 63) return null;
  return `0x${stripped}`;
}

/**
 * The SNIP-12 typed data a Starknet wallet signs.
 *
 * Typed data rather than a plain string because that is what Starknet wallets actually display:
 * the person approving it sees the fields, so the copy has to say plainly that it authorises
 * nothing. The server rebuilds this byte-for-byte to verify, so any drift breaks sign-in loudly
 * rather than letting a mismatched signature through.
 */
export function buildSignInTypedData(args: { address: string; nonce: string; issuedAt: number }) {
  return {
    domain: { name: "Sage", version: "1", chainId: "SN_MAIN", revision: "1" },
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      SignIn: [
        { name: "statement", type: "shortstring" },
        { name: "wallet", type: "felt" },
        { name: "nonce", type: "shortstring" },
        { name: "issuedAt", type: "felt" },
      ],
    },
    primaryType: "SignIn",
    message: {
      statement: "Sage sign-in: moves no funds",
      wallet: args.address,
      nonce: args.nonce,
      issuedAt: String(args.issuedAt),
    },
  };
}

/**
 * A Cairo short string holds at most 31 ASCII characters — it is one felt, and a felt is 252 bits.
 *
 * 16 random bytes render as 32 hex characters, one over, and Ready refused the whole signature
 * with "…is too long". 15 bytes is 30 characters and 120 bits of entropy, which is far more than a
 * login nonce needs. The constant is here so the reason travels with the number.
 */
const NONCE_BYTES = 15;

/**
 * The nonce itself, separated from the cookie it is stored in so its LENGTH can be tested.
 *
 * It was not, and the guard written for it was vacuous: the test supplied its own nonce, so
 * changing the byte count back to the value that broke Ready left every assertion green.
 */
export function newStarknetNonce(): string {
  return randomBytes(NONCE_BYTES).toString("hex");
}

export async function issueStarknetNonce(): Promise<string> {
  const nonce = newStarknetNonce();
  (await cookies()).set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: NONCE_TTL_S,
  });
  return nonce;
}

export interface StarknetVerifyArgs {
  address: string;
  signature: string[];
  issuedAt: number;
  now?: number;
}

/**
 * Verify a Starknet wallet's signature and mint a session.
 *
 * The nonce is read from the httpOnly cookie — server truth — never from the request body, so a
 * captured signature cannot be replayed against an attacker-chosen nonce.
 */
export async function verifyAndCreateStarknetSession(
  args: StarknetVerifyArgs,
): Promise<string | null> {
  const address = normalizeStarknetAddress(args.address);
  if (!address) return null;

  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  if (!nonce) return null;

  const now = args.now ?? Date.now();
  if (!Number.isFinite(args.issuedAt) || Math.abs(now - args.issuedAt) > ISSUED_AT_WINDOW_MS) {
    return null;
  }

  const cfg = starknetAddresses();
  if (!cfg) return null;

  let valid = false;
  try {
    valid = await verifyMessageInStarknet(
      new RpcProvider({ nodeUrl: cfg.rpcUrl }),
      buildSignInTypedData({ address, nonce, issuedAt: args.issuedAt }),
      args.signature,
      address,
    );
  } catch {
    // An undeployed account, an unreachable node, or a malformed signature all land here. None of
    // them are a successful sign-in.
    valid = false;
  }
  if (!valid) return null;

  const issued = now;
  const payload = `${address}.${issued}`;
  jar.set(SESSION_COOKIE, `${b64url(payload)}.${hmac(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  // One nonce, one login.
  jar.delete(NONCE_COOKIE);
  return address;
}

/** The authenticated Starknet address for this request, or null. */
export async function getStarknetSessionAddress(now: number = Date.now()): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? readSessionToken(token, now) : null;
}

/**
 * Pure token reader — exported so the format is testable without a cookie jar.
 *
 * A tampered or expired token reads as logged out, never as an error: an auth check that can throw
 * is an auth check that can be turned into a denial of service, or worse, caught and ignored.
 */
export function readSessionToken(token: string, now: number = Date.now()): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = unb64url(encoded);
  } catch {
    return null;
  }
  if (!safeEqual(sig, hmac(payload))) return null;

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const issued = Number(payload.slice(sep + 1));
  if (!Number.isFinite(issued) || now - issued > SESSION_TTL_MS) return null;
  return normalizeStarknetAddress(payload.slice(0, sep));
}

/** Test seam: build a token the way a real sign-in would. */
export function mintSessionToken(address: string, issued: number): string {
  const payload = `${normalizeStarknetAddress(address)}.${issued}`;
  return `${b64url(payload)}.${hmac(payload)}`;
}

export async function clearStarknetSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
