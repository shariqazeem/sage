"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  useStarknetWallet,
  type StarknetWallet,
} from "@/lib/starknet/use-starknet-wallet";
import { refreshFounderSession } from "./use-founder-session";

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

/** Which wallet extension signed in, so a later signature goes to the same one. */
const WALLET_ID_KEY = "sage.starknet.walletId";

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
  /**
   * Sign typed data with the wallet that is signed in — used for the evidence commitment a
   * mission-bound submission carries. Returns the felt array a Starknet signature is, or null if
   * the person declined.
   *
   * The caller passes the structure; this only asks the wallet. What gets signed is built by ONE
   * shared module (`starknet-evidence-typed-data.ts`) that the server verifies against, for the
   * same reason sign-in takes its typed data from the server: a second implementation is a second
   * thing to drift, and drift means every signature reads as forged.
   */
  signTypedData: (typedData: unknown) => Promise<string[] | null>;
}

export function useStarknetSiwe(): StarknetSiweApi {
  const discovery = useStarknetWallet();
  const [address, setAddress] = useState<string | null>(null);
  /**
   * WHICH EXTENSION THE SESSION BELONGS TO.
   *
   * A person can have Ready AND Xverse installed. `signIn` takes the wallet they picked, so it is
   * known at that moment — but a later signature happens on a different render, and after a reload
   * the session survives while nothing in memory remembers the choice. The id is persisted so the
   * evidence signature goes to the SAME extension that signed in.
   *
   * Reported from the live campaign: signed in with Ready, and pressing submit opened Xverse.
   */
  const signedWith = useRef<StarknetWallet | null>(null);
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

        signedWith.current = wallet;
        try {
          window.localStorage.setItem(WALLET_ID_KEY, wallet.id);
        } catch {
          /* private mode — the in-memory ref still covers this page load */
        }

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
        // Tell every component that reads the founder session, not just the one that rendered this
        // button. Without it the rail kept saying "Sign in" to a founder who had just signed in,
        // until they refreshed the page.
        void refreshFounderSession();
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

  const forgetWallet = () => {
    signedWith.current = null;
    try {
      window.localStorage.removeItem(WALLET_ID_KEY);
    } catch {
      /* nothing to clear */
    }
  };

  const signOut = useCallback(async () => {
    await fetch("/api/auth/starknet/session", { method: "DELETE" }).catch(
      () => {},
    );
    setAddress(null);
    forgetWallet();
    void refreshFounderSession();
    discovery.disconnect();
  }, [discovery]);

  /**
   * Ask the signed-in wallet to sign a structure. Null means the person declined, which is a
   * normal answer and not an error to shout about.
   *
   * The wallet is re-discovered rather than held: discovery is what knows which extension the
   * session belongs to, and holding a reference across a reconnect is how a signature ends up
   * requested from the wrong one.
   */
  const signTypedData = useCallback(
    async (typedData: unknown): Promise<string[] | null> => {
      /**
       * Resolve the extension the session belongs to — never `wallets[0]`.
       *
       * That was the bug: with two wallets installed, discovery order decided who was asked to
       * sign, so a person signed in with Ready and was handed an Xverse prompt. Signing there
       * would produce a valid signature from an account the vault cannot pay, which the server
       * then refuses as a wallet mismatch — a confusing dead end for something the page could have
       * prevented.
       *
       * When the choice genuinely cannot be recovered, REFUSE and say so. Picking a wallet on the
       * person's behalf is what caused this.
       */
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(WALLET_ID_KEY);
      } catch {
        /* unreadable storage falls through to the checks below */
      }
      const wallet =
        signedWith.current ??
        (stored ? (discovery.wallets.find((w) => w.id === stored) ?? null) : null) ??
        (discovery.wallets.length === 1 ? discovery.wallets[0] : null);
      if (!wallet) {
        setError(
          discovery.wallets.length > 1
            ? "Sign in again so Sage knows which of your wallets to ask — more than one is installed."
            : "Reconnect your Starknet wallet to sign.",
        );
        return null;
      }
      /**
       * CONFIRM THE WALLET HOLDS THE ACCOUNT THAT WILL BE PAID, before asking it to sign.
       *
       * Resolving by id fixes the ordering bug, but not every way the wrong extension can end up
       * here: two wallets both inject into `window.starknet*`, and whichever claimed the legacy
       * slot last wins it, so an entry can be labelled one wallet and backed by another. This
       * catches all of them at the only point that matters — a signature from the wrong account is
       * refused server-side as a wallet mismatch, which reads like the product is broken.
       *
       * Cheap for a wallet already authorised for this site: `wallet_requestAccounts` returns
       * without prompting.
       */
      try {
        const accounts = (await wallet.request({ type: "wallet_requestAccounts" })) as string[];
        const held = accounts?.[0];
        if (held && address && BigInt(held) !== BigInt(address)) {
          setError(
            `${wallet.name} is holding a different account than the one you signed in with — switch it back, or sign in again with the wallet that will be paid.`,
          );
          return null;
        }
      } catch {
        // Unreachable or refused: fall through and let the signature attempt report it, rather
        // than blocking a wallet that simply does not answer this call.
      }

      try {
        const sig = (await wallet.request({
          type: "wallet_signTypedData",
          params: typedData as never,
        })) as string[] | { signature?: string[] };
        const out = Array.isArray(sig) ? sig : (sig?.signature ?? []);
        return out.length ? out.map(String) : null;
      } catch {
        return null;
      }
    },
    [discovery.wallets, address],
  );

  return {
    wallets: discovery.wallets,
    address,
    authed: !!address,
    signingIn: signingIn || discovery.connecting,
    loading,
    error: error ?? discovery.error,
    signIn,
    signOut,
    signTypedData,
  };
}
