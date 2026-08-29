"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * IS SOMEONE SIGNED IN AS A FOUNDER, ON EITHER CHAIN?
 *
 * Deliberately NOT folded into `useSiwe`. That hook answers a narrower question — is there an EVM
 * session matching the wallet connected in THIS browser right now — and it must keep answering it,
 * because the EVM deploy flow depends on the cookie and the connected wallet being the same
 * account. Putting a Starknet identity into that comparison would simply make it false: a felt can
 * never equal an EVM address, so a signed-in Starknet founder would read as signed out.
 */

export interface FounderSession {
  address: string | null;
  chain: "evm" | "starknet" | null;
  authed: boolean;
  /** Still asking. Distinct from "signed out", which would wrongly prompt a signed-in founder. */
  loading: boolean;
  refresh: () => Promise<void>;
  /** Ends BOTH sessions — signing out should sign you out, not out of one curve. */
  signOut: () => Promise<void>;
}

export function useFounderSession(): FounderSession {
  const [address, setAddress] = useState<string | null>(null);
  const [chain, setChain] = useState<"evm" | "starknet" | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/founder", { cache: "no-store" });
      const d = (await res.json()) as { address: string | null; chain: "evm" | "starknet" | null };
      setAddress(d.address ?? null);
      setChain(d.chain ?? null);
    } catch {
      // A failed read is not a sign-out: leaving the last known identity in place avoids
      // bouncing a founder to a connect screen because one poll lost the network.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    // Both, unconditionally. Clearing only the session that happens to be reported would leave a
    // founder with two cookies signed out of one and still signed into the other — and the next
    // page load would show them signed in again, which reads as the button not working.
    await Promise.allSettled([
      fetch("/api/auth/session", { method: "DELETE" }),
      fetch("/api/auth/starknet/session", { method: "DELETE" }),
    ]);
    setAddress(null);
    setChain(null);
  }, []);

  return { address, chain, authed: !!address, loading, refresh, signOut };
}
