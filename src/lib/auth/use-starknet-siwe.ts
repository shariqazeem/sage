"use client";

import { useCallback, useEffect, useState } from "react";

import {
  useStarknetWallet,
  type StarknetWallet,
} from "@/lib/starknet/use-starknet-wallet";

/**
 * SIGNING IN WITH A STARKNET WALLET — the tester's side of the private-capable rail.
 *
 * Mirrors `useSiwe`, and exists for the same single reason: THE ADDRESS THAT SIGNED IN IS THE
 * ADDRESS THAT GETS PAID. A payout must never go to an address supplied alongside a submission,
 * only to one that proved control of itself, or anyone could do the work and direct the money
 * somewhere else.
 *
 * Kept separate from `useSiwe` rather than generalised. The two curves have different signature
 * shapes and different account models — Starknet accounts are contracts, and validate signatures
 * themselves — and folding them together would put a branch inside the one piece of code whose
 * job is deciding where money goes.
 *
 * The browser does not build what it signs. The server returns the typed data and the browser
 * fills in only the wallet address, because verification rebuilds that structure server-side and
 * compares: a second implementation here would be a second thing to drift, and drift means every
 * signature reads as forged with nothing on screen to explain why.
 */

export interface StarknetSiweApi {
  wallets: StarknetWallet[];
  address: string | null;
  authed: boolean;
  signingIn: boolean;
  /** Still checking for an existing session — distinct from "signed out". */
  loading: boolean;
  error: string | null;
  signIn: (wallet: StarknetWallet) => Promise<boolean>;
  signOut: () => Promise<void>;
}

export function useStarknetSiwe(): StarknetSiweApi {
  const discovery = useStarknetWallet();
  const [address, setAddress] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // An existing session must be recognised on load, or a signed-in tester is shown a connect
  // button and asked to sign again for no reason.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/starknet/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.address) setAddress(d.address as string);
      })
      .catch(() => {
        /* no session is the normal case, not an error worth showing */
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (wallet: StarknetWallet): Promise<boolean> => {
      setError(null);
      setSigningIn(true);
      try {
        const accounts = (await wallet.request({
          type: "wallet_requestAccounts",
        })) as string[];
        const account = accounts?.[0];
        if (!account)
          throw new Error(
            "That wallet did not share an account. Unlock it and try again.",
          );

        const nonceRes = await fetch("/api/auth/starknet/nonce", {
          cache: "no-store",
        });
        if (!nonceRes.ok)
          throw new Error(
            "Could not start sign-in. Check your connection and retry.",
          );
        const { issuedAt, typedData } = (await nonceRes.json()) as {
          issuedAt: number;
          typedData: { message: Record<string, unknown> };
        };

        const toSign = {
          ...typedData,
          message: { ...typedData.message, wallet: account },
        };
        const signature = (await wallet.request({
          type: "wallet_signTypedData",
          params: toSign,
        })) as string[] | { signature?: string[] };

        const sig = Array.isArray(signature)
          ? signature
          : (signature?.signature ?? []);
        if (!sig.length)
          throw new Error(
            "That wallet did not return a signature. Try signing in again.",
          );

        const verifyRes = await fetch("/api/auth/starknet/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: account, signature: sig, issuedAt }),
        });
        if (!verifyRes.ok) {
          // The server deliberately gives one message for every failure, so there is nothing more
          // specific to report here without inventing it.
          throw new Error(
            "That signature could not be verified. Try signing in again.",
          );
        }
        const { address: verified } = (await verifyRes.json()) as {
          address: string;
        };
        setAddress(verified);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(
          /rejected|denied|cancel/i.test(msg)
            ? "You cancelled the signature."
            : msg,
        );
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/starknet/session", { method: "DELETE" }).catch(
      () => {},
    );
    setAddress(null);
    discovery.disconnect();
  }, [discovery]);

  return {
    wallets: discovery.wallets,
    address,
    authed: !!address,
    signingIn: signingIn || discovery.connecting,
    loading,
    error: error ?? discovery.error,
    signIn,
    signOut,
  };
}
