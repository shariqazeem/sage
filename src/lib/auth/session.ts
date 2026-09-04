import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAddress, verifyMessage, type Address } from "viem";
import { buildSiweMessage, NONCE_COOKIE, SESSION_COOKIE } from "./message";

/* ───────────────────────────────────────────────── signing secret ──────
 * HMAC secret for the stateless session token. Set SAGE_SESSION_SECRET in prod.
 * A fixed dev fallback keeps local runs zero-config (and is clearly flagged) —
 * it must never be relied on in production, where the env var is required.
 */
const DEV_SECRET = "sage-dev-session-secret-not-for-production";
function sessionSecret(): string {
  const s = process.env.SAGE_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SAGE_SESSION_SECRET is required in production.");
  }
  return DEV_SECRET;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}
function hmac(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ─────────────────────────────────────────────────────── nonce ────── */

/** Issue a fresh login nonce and stash it in a short-lived httpOnly cookie. */
export async function issueNonce(): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: NONCE_TTL_MS / 1000,
  });
  return nonce;
}

async function readNonce(): Promise<string | null> {
  return (await cookies()).get(NONCE_COOKIE)?.value ?? null;
}

/* ─────────────────────────────────────────────── verify + session ───── */

/**
 * Verify a wallet's signature over the SIWE-lite message and, on success, mint a
 * session cookie. The nonce is taken from the httpOnly cookie (server truth),
 * never from the body, so a signature can't be replayed with an attacker-chosen
 * nonce. Returns the checksummed address or null.
 */
/**
 * THE PROOF, SEPARATED FROM WHAT IS DONE WITH IT. A valid SIWE signature against the live nonce
 * proves control of `address` — and that proof has two honest uses: become the session (sign in),
 * or be JOINED to the session that already exists (bind). Verifying is the same either way, so it
 * is one function; only the consequence differs.
 */
export async function verifySiweSignature(args: {
  address: string;
  signature: string;
  issuedAt: string;
}): Promise<Address | null> {
  let address: Address;
  try {
    address = getAddress(args.address);
  } catch {
    return null;
  }

  const nonce = await readNonce();
  if (!nonce) return null;

  // Bind issuedAt to a recent window so an old signature can't be reused.
  const issuedMs = Date.parse(args.issuedAt);
  if (!Number.isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > NONCE_TTL_MS) {
    return null;
  }

  const message = buildSiweMessage({ address, nonce, issuedAt: args.issuedAt });
  let valid = false;
  try {
    valid = await verifyMessage({
      address,
      message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return null;
  }
  return valid ? address : null;
}

export async function verifyAndCreateSession(args: {
  address: string;
  signature: string;
  issuedAt: string;
}): Promise<Address | null> {
  const address = await verifySiweSignature(args);
  if (!address) return null;
  await mintSession(address);
  // One nonce, one login: clear it so the signature can't be replayed.
  (await cookies()).delete(NONCE_COOKIE);
  return address;
}

/** What a proven wallet becomes, given who is already signed in. Pure. */
export function bindDecision(session: string | null, proven: string): "no_session" | "same" | "bind" {
  if (!session) return "no_session";
  return session.toLowerCase() === proven.toLowerCase() ? "same" : "bind";
}

/**
 * ADD A WALLET TO THE ACCOUNT THAT IS ALREADY SIGNED IN — bind, never replace.
 *
 * Email sign-in and wallet sign-in wrote the same cookie, so connecting an Ethereum wallet after
 * signing in by email silently REPLACED the account: the workspace, the campaigns and the record
 * were suddenly under the other address, and the founder was asked to set up from scratch
 * (reported 2026-09-05: "it should be binded in same email right?"). The two proofs present here —
 * a live session and a fresh signature — are the same evidence standard the existing rail-link
 * route requires, so the wallet is joined to the account as a DECLARED link and the session is
 * left exactly as it was.
 *
 * Nothing to bind to → refuse, which is also what makes a shared computer safe: with no session
 * there is no account to attach a stranger's wallet to.
 */
export async function verifyAndBindToSession(args: {
  address: string;
  signature: string;
  issuedAt: string;
}): Promise<{ ok: true; account: Address; bound: Address | null } | { ok: false; reason: "invalid" | "no_session" }> {
  const proven = await verifySiweSignature(args);
  if (!proven) return { ok: false, reason: "invalid" };
  const session = await getSessionAddress();
  const decision = bindDecision(session, proven);
  if (decision === "no_session" || !session) return { ok: false, reason: "no_session" };
  (await cookies()).delete(NONCE_COOKIE);
  if (decision === "same") return { ok: true, account: session, bound: null };
  const { linkWallets } = await import("@/lib/campaigns/wallet-links");
  linkWallets(session, proven, Math.floor(Date.now() / 1000), "declared");
  return { ok: true, account: session, bound: proven };
}

/**
 * PRIVY SIGN-IN. The address was not proven by a signature in this request: Privy verified the
 * person (email, passkey, social) and reports the embedded wallet it holds for them. The server
 * verifies Privy's token and then mints the SAME session a SIWE sign-in would — one identity
 * model, two doors. Only the Privy route may call this.
 */
export async function createSessionForVerifiedAddress(address: string): Promise<Address | null> {
  let a: Address;
  try {
    a = getAddress(address);
  } catch {
    return null;
  }
  await mintSession(a);
  return a;
}

async function mintSession(address: Address): Promise<void> {
  const issued = Date.now();
  const payload = `${address}.${issued}`;
  const token = `${b64url(payload)}.${hmac(payload)}`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/**
 * The authenticated wallet for the current request, or null. Verifies the HMAC
 * and the TTL — a tampered or expired token reads as logged-out.
 */
export async function getSessionAddress(): Promise<Address | null> {
  // DEV-ONLY session bypass — lets local visual/QA work render the wallet-gated surfaces (console,
  // dashboard) without a browser wallet. Doubly gated: NODE_ENV must be "development" AND
  // DEV_SESSION_WALLET must be set to a valid address. In production NODE_ENV is "production" (skipped)
  // and the var is never set, so this is unreachable there. A malformed value falls through to the real
  // cookie check rather than logging anyone in.
  if (process.env.NODE_ENV === "development" && process.env.DEV_SESSION_WALLET) {
    try {
      return getAddress(process.env.DEV_SESSION_WALLET);
    } catch {
      /* fall through */
    }
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
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
  const addr = payload.slice(0, sep);
  const issued = Number(payload.slice(sep + 1));
  if (!Number.isFinite(issued) || Date.now() - issued > SESSION_TTL_MS) return null;

  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

/** Log out: drop the session cookie. */
export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** True when the session wallet equals `wallet` (case-insensitive). */
export function isSameWallet(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
