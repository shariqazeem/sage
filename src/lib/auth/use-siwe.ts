"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress } from "viem";
import { useWallet, type WalletApi } from "@/lib/wallet/use-wallet";
import { buildSiweMessage } from "./message";
import { refreshFounderSession, SIGNED_OUT_EVENT } from "./use-founder-session";

export interface SiweApi {
  /** The connected wallet (may differ from the authed one until re-signed). */
  address: string | null;
  /** The wallet the current session cookie is bound to, or null. */
  authedAddress: string | null;
  /** True when the session matches the connected wallet. */
  authed: boolean;
  available: boolean;
  chainId: number | null;
  onMetis: boolean;
  onChain: (chainId: number) => boolean;
  connecting: boolean;
  signingIn: boolean;
  /** connect the browser wallet; resolves to its account. */
  connect: () => Promise<string | null>;
  switchToMetis: () => Promise<void>;
  switchToChain: (chainId: number) => Promise<void>;
  /** Run the SIWE-lite flow (connect → nonce → sign → verify). `bind` joins the wallet to the
   *  account already signed in instead of replacing it. A plain sign-in REFUSES to replace a session
   *  that belongs to a different wallet unless `replace` is set explicitly (see `conflict`). */
  signIn: (opts?: { mode?: "signin" | "bind"; replace?: boolean }) => Promise<boolean>;
  /** Set when a sign-in was refused because someone else is already signed in here: that session's
   *  address. The caller explains it; nothing was replaced. */
  conflict: string | null;
  signOut: () => Promise<void>;
  /** Re-read the session cookie — after a sign-in that happened outside this hook (the email door). */
  refresh: () => Promise<void>;
}

/**
 * Client-side sign-in with the connected wallet. Reads the current session on
 * mount, and `signIn()` walks the full SIWE-lite handshake against the auth
 * routes. Pure UI glue — every security decision is made server-side; this just
 * gathers a signature.
 */
export function useSiwe(injectedWallet?: WalletApi): SiweApi {
  // Accept a shared wallet instance so a host (the deploy wizard) can unify SIWE +
  // on-chain steps on ONE useWallet — otherwise the wizard's own useWallet and this
  // one diverge (connected here, empty there → "connect wallet" on an active wallet).
  const own = useWallet();
  const w = injectedWallet ?? own;
  const [authedAddress, setAuthedAddress] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const json = (await res.json()) as { address?: string | null };
      setAuthedAddress(json.address ?? null);
    } catch {
      setAuthedAddress(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (opts: { mode?: "signin" | "bind"; replace?: boolean } = {}): Promise<boolean> => {
    // Connecting resolves to the account, so one click connects AND signs (connecting moves the wallet to
    // Metis). The signature itself is chain-independent, but the wallet shows the network it is on while
    // asking for it, and Sage runs on Metis: a wallet already connected is moved there too (26 Oct 2026,
    // the founder saw "GOAT Network" on this request). Declining still lets the sign-in go ahead.
    let address = w.address;
    if (!address) address = await w.connect();
    else if (!w.onMetis) await w.switchToMetis().catch(() => undefined);
    const wallet = w.getWalletClient();
    if (!address || !wallet) return false;
    /*
      NEVER SWAP WHO IS SIGNED IN BEHIND THEIR BACK (Demo Day, 10 Oct 2026). A founder signed in by
      email clicked a wallet button on the plan page; the plain sign-in here replaced the email session,
      and the account, which belongs to the email identity, vanished mid-demo. A sign-in now refuses
      to replace a session that belongs to a different wallet. Linking is `mode: "bind"`; switching
      accounts is an explicit `replace` (or signing out first).
    */
    const mode = opts.mode ?? "signin";
    const current = await fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ address?: string | null }>)
      .then((j) => j.address ?? null)
      .catch(() => authedAddress);
    if (mode === "signin" && !opts.replace && current && current.toLowerCase() !== address.toLowerCase()) {
      setConflict(current);
      return false;
    }
    setConflict(null);
    // Checksum the address so the message we sign is byte-identical to the one
    // the server rebuilds (it checksums via getAddress). A lowercase injected
    // address would sign a different message and verification would always fail.
    const account = getAddress(address);

    setSigningIn(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      const { nonce } = (await nonceRes.json()) as { nonce: string };
      const issuedAt = new Date().toISOString();
      const message = buildSiweMessage({ address: account, nonce, issuedAt });
      const signature = await wallet.signMessage({ account, message });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account, signature, issuedAt, mode: opts.mode ?? "signin" }),
      });
      if (!verifyRes.ok) return false;
      const json = (await verifyRes.json()) as { address?: string };
      setAuthedAddress(json.address ?? account);
      // Same reason as the Starknet hook: the shared founder session backs the rail and several
      // pages, and none of them rendered this button.
      void refreshFounderSession();
      return true;
    } catch {
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [w, authedAddress]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setAuthedAddress(null);
    // Privy's own session outlives ours unless it is told; see use-founder-session.
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    void refreshFounderSession();
  }, []);

  const authed =
    !!authedAddress &&
    !!w.address &&
    authedAddress.toLowerCase() === w.address.toLowerCase();

  return {
    address: w.address,
    authedAddress,
    authed,
    available: w.available,
    chainId: w.chainId,
    onMetis: w.onMetis,
    onChain: w.onChain,
    connecting: w.connecting,
    signingIn,
    connect: w.connect,
    switchToMetis: w.switchToMetis,
    switchToChain: w.switchToChain,
    refresh,
    signIn,
    conflict,
    signOut,
  };
}
