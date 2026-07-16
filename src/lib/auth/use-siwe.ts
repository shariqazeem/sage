"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress } from "viem";
import { useWallet, type WalletApi } from "@/lib/wallet/use-wallet";
import { buildSiweMessage } from "./message";

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
  connect: () => Promise<void>;
  switchToMetis: () => Promise<void>;
  switchToChain: (chainId: number) => Promise<void>;
  /** Run the SIWE-lite flow (connect → nonce → sign → verify). */
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
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

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!w.address) await w.connect();
    // SIWE (personal_sign) is chain-independent — don't force a network switch here.
    // The launch wizard switches to the founder's chosen chain only for the on-chain steps.
    const wallet = w.getWalletClient();
    if (!w.address || !wallet) return false;
    // Checksum the address so the message we sign is byte-identical to the one
    // the server rebuilds (it checksums via getAddress). A lowercase injected
    // address would sign a different message and verification would always fail.
    const account = getAddress(w.address);

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
        body: JSON.stringify({ address: account, signature, issuedAt }),
      });
      if (!verifyRes.ok) return false;
      const json = (await verifyRes.json()) as { address?: string };
      setAuthedAddress(json.address ?? account);
      return true;
    } catch {
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [w]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setAuthedAddress(null);
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
    signIn,
    signOut,
  };
}
