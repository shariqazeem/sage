import "server-only";
import { PrivyClient, type User } from "@privy-io/server-auth";

/**
 * The Privy app that signs people IN (email / passkey / social + an embedded wallet). A separate
 * Privy app from the one that mints server wallets for Telegram recipients; both may exist.
 */
export function privyLoginConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim() && process.env.PRIVY_LOGIN_APP_SECRET?.trim());
}

function client(): PrivyClient | null {
  const id = process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();
  const secret = process.env.PRIVY_LOGIN_APP_SECRET?.trim();
  if (!id || !secret) return null;
  return new PrivyClient(id, secret);
}

/** The Ethereum address Privy holds for this user — the embedded wallet first, any linked Ethereum wallet second. */
export function ethereumAddressOf(user: User): string | null {
  const w = user.wallet;
  if (w && (w.chainType === "ethereum" || !w.chainType) && /^0x[0-9a-fA-F]{40}$/.test(w.address)) return w.address;
  for (const acct of user.linkedAccounts ?? []) {
    const a = acct as { type?: string; chainType?: string; address?: string };
    if (a.type === "wallet" && (a.chainType === "ethereum" || !a.chainType) && a.address && /^0x[0-9a-fA-F]{40}$/.test(a.address)) return a.address;
  }
  return null;
}

export type PrivyLoginResult =
  | { ok: true; address: string; userId: string }
  | { ok: false; reason: "not_configured" | "invalid_token" | "no_wallet_yet" | "error"; detail?: string };

/** Verify a Privy access token and resolve the person's Ethereum address. Never throws. */
export async function resolvePrivyLogin(token: string): Promise<PrivyLoginResult> {
  const c = client();
  if (!c) return { ok: false, reason: "not_configured" };
  let userId: string;
  try {
    const claims = await c.verifyAuthToken(token);
    userId = claims.userId;
  } catch (e) {
    return { ok: false, reason: "invalid_token", detail: e instanceof Error ? e.message : String(e) };
  }
  try {
    let user = await c.getUserById(userId);
    let address = ethereumAddressOf(user);
    if (!address) {
      // The browser normally creates the embedded wallet at login; when it has not (measured live
      // 2026-09-05: the exchange looped on "no wallet" and gave up), the server creates it — the
      // same embedded wallet, held by Privy for this user, not a server wallet of ours.
      try {
        await c.createWallets({ userId, createEthereumWallet: true });
        user = await c.getUserById(userId);
        address = ethereumAddressOf(user);
      } catch (e) {
        console.warn("[privy-login] createWallets failed:", e instanceof Error ? e.message : String(e));
      }
    }
    if (!address) {
      console.warn("[privy-login] no ethereum wallet on user", userId, "accounts:", (user.linkedAccounts ?? []).map((a) => (a as { type?: string }).type).join(","));
      return { ok: false, reason: "no_wallet_yet" };
    }
    return { ok: true, address, userId };
  } catch (e) {
    console.warn("[privy-login] lookup failed:", e instanceof Error ? e.message : String(e));
    return { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}
