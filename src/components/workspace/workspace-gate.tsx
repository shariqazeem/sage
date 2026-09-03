"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Users } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { short } from "@/lib/format";

/**
 * The door to a workspace. Not signed in → sign in (free signature, no transaction). Signed in with
 * no workspace and no membership → name one, or paste an invite link. One intent, one field.
 */
export function WorkspaceGate({ signedIn = false, address = null }: { signedIn?: boolean; address?: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState("");

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Could not create the workspace.");
        return;
      }
      router.refresh();
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    const code = invite.trim().split("/").pop()?.split("?")[0] ?? "";
    if (!code.startsWith("ws_inv_")) {
      setErr("Paste the whole invite link — it ends in ws_inv_…");
      return;
    }
    router.push(`/join/${code}`);
  };

  return (
    <main className="ws-shell">
      <div className="sage-agent-card ws-onboard">
        <div className="sage-eyebrow">
          <Building2 size={13} /> Sage for teams
        </div>
        {!signedIn ? (
          <>
            <h1 className="ws-title">Your team&rsquo;s workspace</h1>
            <p className="ws-sub">
              Invite your people, post the work, set the budget. Sage verifies what they deliver and pays inside limits you set — every payout with a receipt.
            </p>
            <div style={{ marginTop: 16 }}>
              <FounderSignIn explainer={<>Sign in with the wallet that will fund the work — <b>Ethereum or Starknet.</b></>} onSignedIn={() => router.refresh()} />
            </div>
          </>
        ) : (
          <>
            <h1 className="ws-title">Name your workspace</h1>
            <p className="ws-sub">
              Signed in as <span className="mono">{address ? short(address) : ""}</span>. A workspace is your team, its members and the work you pay them for. Free for you and two more people.
            </p>
            <div className="sage-field" style={{ marginTop: 14 }}>
              <label className="sage-label">Workspace name</label>
              <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kingston Market Co-op" maxLength={60} disabled={busy} />
            </div>
            <button className="sage-btn sage-btn-primary" onClick={() => void create()} disabled={busy || name.trim().length < 2} style={{ marginTop: 10 }}>
              {busy ? <><Loader2 size={15} className="sage-spin2" /> Creating…</> : <><Users size={15} /> Create workspace</>}
            </button>
            <div className="sb-sec-label" style={{ marginTop: 22 }}>Or join a team</div>
            <div className="ws-invite">
              <input className="ws-input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Paste an invite link" />
              <button className="sage-btn sage-btn-sm" onClick={join}>Join</button>
            </div>
            {err && <p className="ws-err">{err}</p>}
          </>
        )}
      </div>
    </main>
  );
}
