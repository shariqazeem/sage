"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Users } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { EmailSignIn } from "@/components/auth/email-sign-in";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { short } from "@/lib/format";
import { SageMark } from "@/components/brand/sage-mark";

/** `/join/<code>` — the invited person's door: the team's name, sign in, join, land in the workspace. */
export function JoinCard({ code, workspaceName, open, emailEnabled = false }: { code: string; workspaceName: string | null; open: boolean; emailEnabled?: boolean }) {
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
    <main className="st-shell">
      <div className="st-brand"><SageMark size={22} /><span>Sage</span></div>
      <div className="st-card">
        {!workspaceName || !open ? (
          <div className="st-pane">
            <h1 className="st-h1">This invite link isn&rsquo;t open</h1>
            <p className="st-p">It may have been revoked or used up. Ask the person who sent it for a fresh one.</p>
          </div>
        ) : (
          <div className="st-pane">
            <span className="ws-eyebrow">Invitation</span>
            <h1 className="st-h1" style={{ marginTop: 8 }}>Join &ldquo;{workspaceName}&rdquo;</h1>
            <p className="st-p">You&rsquo;ll see the work this team posts, submit yours, and get paid to the account you sign in with — verified by Sage, with a receipt for every payout.</p>
            {!session.authed ? (
              <>
                {emailEnabled && (
                  <>
                    <EmailSignIn onSignedIn={() => session.refresh()} />
                    <div className="st-or"><span>or a wallet you already have</span></div>
                  </>
                )}
                <FounderSignIn explainer={<>Sign in with the wallet you want to be <b>paid at</b> — Ethereum or Starknet.</>} onSignedIn={() => session.refresh()} />
              </>
            ) : done ? (
              <p className="ws-ok"><Check size={14} /> You&rsquo;re in — opening your workspace…</p>
            ) : (
              <>
                <p className="st-p">Signed in as <span className="mono">{session.address ? short(session.address) : ""}</span>.</p>
                <button className="sage-btn sage-btn-primary" onClick={() => void join()} disabled={busy}>
                  {busy ? <><Loader2 size={15} className="sage-spin2" /> Joining…</> : <><Users size={15} /> Join this workspace</>}
                </button>
              </>
            )}
            {err && <p className="ws-err">{err}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
