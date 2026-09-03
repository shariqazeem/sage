"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Mail } from "lucide-react";

/**
 * "Continue with email." Privy verifies the person; the browser makes sure an embedded wallet
 * exists for them (creating one if login did not); the server verifies Privy's token and mints the
 * same Sage session a wallet signature would.
 *
 * The first live attempt (2026-09-05) sat on "Signing you in…" forever: the server never saw a
 * wallet on the account, the retry loop gave up, and a cancelled effect skipped the reset. Now
 * the wallet is created client-side before the exchange, the exchange itself retries briefly,
 * every path resets the button, and a failed attempt logs Privy out so the next click starts clean.
 */
export function EmailSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { ready, authenticated, user, login, logout, getAccessToken, createWallet } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const armed = useRef(false);
  const running = useRef(false);

  const exchange = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setErr(null);
    try {
      // 1. the embedded wallet — create it if login did not
      const hasEvm = !!user?.wallet?.address || (user?.linkedAccounts ?? []).some((a) => a.type === "wallet" && (a as { chainType?: string }).chainType === "ethereum");
      if (!hasEvm) {
        try {
          await createWallet();
        } catch (e) {
          // "already has a wallet" is fine; anything else surfaces below when the server looks
          console.warn("[email-sign-in] createWallet:", e instanceof Error ? e.message : e);
        }
      }
      // 2. the exchange — the server verifies the token and reads the wallet from Privy
      for (let i = 0; i < 8; i++) {
        const token = await getAccessToken();
        if (!token) throw new Error("No session from Privy — try again.");
        const res = await fetch("/api/auth/privy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
        const json = (await res.json()) as { error?: string; retryable?: boolean };
        if (res.ok) {
          onSignedIn();
          return;
        }
        if (!json.retryable) throw new Error(json.error ?? "Sign-in failed.");
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Your wallet is taking longer than usual to be created. Click again — nothing was lost.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed.");
      await logout().catch(() => undefined);
    } finally {
      running.current = false;
      armed.current = false;
      setBusy(false);
    }
  }, [user, createWallet, getAccessToken, logout, onSignedIn]);

  useEffect(() => {
    if (armed.current && authenticated && ready) void exchange();
  }, [authenticated, ready, exchange]);

  const start = async () => {
    setErr(null);
    if (authenticated) {
      // a Privy session from an earlier attempt: reuse it rather than asking for another code
      armed.current = true;
      void exchange();
      return;
    }
    armed.current = true;
    login();
  };

  return (
    <div className="es-wrap">
      <button className="sage-btn sage-btn-primary es-btn" onClick={() => void start()} disabled={!ready || busy}>
        {busy ? <><Loader2 size={15} className="sage-spin2" /> Signing you in…</> : <><Mail size={15} /> Continue with email</>}
      </button>
      {err && <p className="ws-err">{err}</p>}
    </div>
  );
}
