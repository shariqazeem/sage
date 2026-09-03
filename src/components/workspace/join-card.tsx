"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2 } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { short } from "@/lib/format";

/** `/join/<code>` — the invited person's door: see the team's name, sign in, join, land in the workspace. */
export function JoinCard({ code, workspaceName, open }: { code: string; workspaceName: string | null; open: boolean }) {
  const router = useRouter();
  const session = useFounderSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/workspaces/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Could not join.");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/workspace"), 600);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ws-shell">
      <div className="sage-agent-card ws-onboard">
        <div className="sage-eyebrow">
          <Building2 size={13} /> Invitation
        </div>
        {!workspaceName || !open ? (
          <>
            <h1 className="ws-title">This invite link isn&rsquo;t open</h1>
            <p className="ws-sub">It may have been revoked or used up. Ask the person who sent it for a fresh one.</p>
          </>
        ) : (
          <>
            <h1 className="ws-title">Join “{workspaceName}”</h1>
            <p className="ws-sub">
              You&rsquo;ll see the work this team posts, submit yours, and get paid to the wallet you sign in with — verified by Sage, with a receipt for every payout.
            </p>
            {!session.authed ? (
              <div style={{ marginTop: 16 }}>
                <FounderSignIn explainer={<>Sign in with the wallet you want to be <b>paid at</b> — Ethereum or Starknet.</>} onSignedIn={() => session.refresh()} />
              </div>
            ) : done ? (
              <p className="ws-ok"><Check size={14} /> You&rsquo;re in — opening your workspace…</p>
            ) : (
              <>
                <p className="ws-sub">Signed in as <span className="mono">{session.address ? short(session.address) : ""}</span>.</p>
                <button className="sage-btn sage-btn-primary" onClick={() => void join()} disabled={busy} style={{ marginTop: 12 }}>
                  {busy ? <><Loader2 size={15} className="sage-spin2" /> Joining…</> : "Join this workspace"}
                </button>
              </>
            )}
            {err && <p className="ws-err">{err}</p>}
          </>
        )}
      </div>
    </main>
  );
}
