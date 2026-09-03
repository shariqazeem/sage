"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Mail } from "lucide-react";

/**
 * "Continue with email." Privy verifies the person and holds an embedded wallet for them; the
 * server verifies Privy's token and mints the same Sage session a wallet signature would. A brand-
 * new account's wallet can take a moment to exist, so the exchange retries briefly.
 */
export function EmailSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { ready, authenticated, login, getAccessToken, logout } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (!armed.current || !authenticated) return;
    armed.current = false;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        for (let i = 0; i < 10 && !cancelled; i++) {
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
        throw new Error("Your wallet is taking a while to be created — try again in a moment.");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Sign-in failed.");
        await logout().catch(() => undefined);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken, logout, onSignedIn]);

  const start = async () => {
    setErr(null);
    armed.current = true;
    if (authenticated) await logout().catch(() => undefined);
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
