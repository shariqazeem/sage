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
 *
 * ONE ANSWER, SHARED BY EVERY CALLER. Eleven components use this hook, and each used to mount its
 * own uncached fetch of a `force-dynamic` route. Loading a campaign page fired a burst of identical
 * requests that raced each other: the rail could still be waiting while the page already knew, so
 * it rendered "Sign in" to a signed-in founder — and on a slow reply the whole shell felt stuck
 * until a refresh. The request is now deduplicated in the module, and every subscriber is told the
 * same answer at the same moment.
 */

export interface FounderIdentity {
  address: string | null;
  chain: "evm" | "starknet" | null;
}

type State = { identity: FounderIdentity; loading: boolean };

/** The one answer. `loading` is true until the first reply, never after. */
let state: State = { identity: { address: null, chain: null }, loading: true };
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(s: State) => void>();

const publish = (next: State) => {
  state = next;
  for (const fn of subscribers) fn(state);
};

function load(force: boolean): Promise<void> {
  // A second caller during a request joins the first rather than starting another.
  if (inFlight && !force) return inFlight;
  const run = (async () => {
    try {
      const res = await fetch("/api/auth/founder", { cache: "no-store" });
      const d = (await res.json()) as FounderIdentity;
      publish({ identity: { address: d.address ?? null, chain: d.chain ?? null }, loading: false });
    } catch {
      // A failed read is not a sign-out: keep the last known identity rather than bouncing a
      // signed-in founder to a connect screen because one poll lost the network.
      publish({ identity: state.identity, loading: false });
    } finally {
      inFlight = null;
    }
  })();
  inFlight = run;
  return run;
}

/** Tell every mounted component the session changed — after a sign-in or sign-out. */
export function refreshFounderSession(): Promise<void> {
  return load(true);
}

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
  const [local, setLocal] = useState<State>(state);

  useEffect(() => {
    subscribers.add(setLocal);
    setLocal(state);
    // Only the first mount starts a request; the rest join it or read the answer already held.
    if (state.loading) void load(false);
    return () => {
      subscribers.delete(setLocal);
    };
  }, []);

  const refresh = useCallback(() => refreshFounderSession(), []);

  const signOut = useCallback(async () => {
    // Both, unconditionally. Clearing only the session that happens to be reported would leave a
    // founder signed out of one cookie and still signed into the other — and the next page load
    // would show them signed in again, which reads as the button not working.
    await Promise.allSettled([
      fetch("/api/auth/session", { method: "DELETE" }),
      fetch("/api/auth/starknet/session", { method: "DELETE" }),
    ]);
    publish({ identity: { address: null, chain: null }, loading: false });
  }, []);

  return {
    address: local.identity.address,
    chain: local.identity.chain,
    authed: !!local.identity.address,
    loading: local.loading,
    refresh,
    signOut,
  };
}

/** Test seam: forget the shared answer so each test starts from an unasked state. */
export function __resetFounderSessionForTest(): void {
  state = { identity: { address: null, chain: null }, loading: true };
  inFlight = null;
  subscribers.clear();
}
