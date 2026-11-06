"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { short } from "@/lib/format";
import { SageMark } from "@/components/brand/sage-mark";

export interface SeatView {
  title: string;
  rewardUsd: number | null;
  seatsLeft: number;
  everyDays: number | null;
  roundsTotal: number | null;
  campaignId: string | null;
}

const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

/**
 * `/join/seat_…`: a person's door to a job someone sent them. One link, N places. They sign in with an
 * email or MetaMask, take a place, and do the work on the job's page. No app and no World ID: the person
 * who sent the link vouched for who they sent it to.
 */
export function SeatCard({ code, view, emailEnabled = false }: { code: string; view: SeatView | null; emailEnabled?: boolean }) {
  const router = useRouter();
  const session = useFounderSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ campaignId: string | null } | null>(null);

  const take = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/seats/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const json = (await res.json()) as { error?: string; campaignId?: string | null };
      if (!res.ok) {
        setErr(json.error ?? "Could not take your place.");
        return;
      }
      setJoined({ campaignId: json.campaignId ?? null });
      if (json.campaignId) setTimeout(() => router.push(`/c/${json.campaignId}`), 700);
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const weekly = view?.everyDays === 7;
  return (
    <main className="st-shell">
      <div className="st-brand"><SageMark size={22} /><span>Sage</span></div>
      <div className="st-card">
        {!view ? (
          <div className="st-pane">
            <h1 className="st-h1">This link isn&rsquo;t open</h1>
            <p className="st-p">The job may have closed, or the link was turned off. Ask the person who sent it.</p>
          </div>
        ) : (
          <div className="st-pane">
            <span className="ws-eyebrow">{weekly ? `Every week${view.roundsTotal ? ` for ${view.roundsTotal} weeks` : ""}` : "You were sent a job"}</span>
            <h1 className="st-h1 seat-title">{view.title}</h1>
            <p className="st-p">
              {view.rewardUsd !== null ? <>Pays <b className="mono">{money(view.rewardUsd)}</b> in USDC{weekly ? " each week" : ""}. </> : null}
              Do the work, and Sage checks it and pays you in minutes, with a public receipt for every payout.
            </p>
            {joined ? (
              <p className="ws-ok">
                <Check size={14} /> You&rsquo;re in. {joined.campaignId ? "Opening the work…" : "The next round opens soon, and this link takes you to it."}
              </p>
            ) : view.seatsLeft <= 0 && !session.authed ? (
              <p className="st-p">Every place is taken. Ask whoever sent the link whether there is room.</p>
            ) : !session.authed ? (
              <FounderSignIn email={emailEnabled} explainer={<>Sign in with your <b>email</b> or <b>MetaMask</b>. You&rsquo;re paid to the account you sign in with.</>} onSignedIn={() => session.refresh()} />
            ) : (
              <>
                <p className="st-p">Signed in as <span className="mono">{session.address ? short(session.address) : ""}</span>.</p>
                <button className="sage-btn sage-btn-primary" onClick={() => void take()} disabled={busy}>
                  {busy ? <><Loader2 size={15} className="sage-spin2" /> Taking your place…</> : <>Take my place <ArrowRight size={15} /></>}
                </button>
                <p className="st-p seat-left">{view.seatsLeft} {view.seatsLeft === 1 ? "place" : "places"} left</p>
              </>
            )}
            {err && <p className="ws-err">{err}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
