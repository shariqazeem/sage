"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Briefcase, Check, ChevronRight, Compass, FlaskConical, Loader2, Lock, Users } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { EmailSignIn } from "@/components/auth/email-sign-in";
import { SageMark } from "@/components/brand/sage-mark";

type Intent = "pay" | "earn" | "test";

/**
 * ENTERING SAGE. Three screens, one question each, one card that stays put while its contents
 * change: who you are (a wallet or an email), what you are here to do, and the one detail that
 * sets you up. Motion is entrance-only and collapses under reduced-motion.
 */
export function StartFlow({ signedIn, address, hasMemberships, emailEnabled = false }: { signedIn: boolean; address: string | null; hasMemberships: boolean; emailEnabled?: boolean }) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState("");

  const step = !signedIn ? 1 : !intent ? 2 : 3;
  const progress = step === 1 ? 18 : step === 2 ? 58 : 100;

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
      router.push("/workspace");
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
    <main className="st-shell">
      <div className="st-brand"><SageMark size={22} /><span>Sage</span></div>
      <ol className="st-steps" aria-label="Steps">
        {["Sign in", "What you're here for", "Set up"].map((label, i) => (
          <li key={label} className={`st-step${step === i + 1 ? " on" : step > i + 1 ? " done" : ""}`}>
            <span className="st-step-n">{step > i + 1 ? <Check size={12} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="st-bar" aria-hidden><i style={{ width: `${progress}%` }} /></div>

      <div className="st-card">
        {step === 1 && (
          <div className="st-pane" key="s1">
            <h1 className="st-h1">Welcome to Sage</h1>
            {emailEnabled ? (
              <>
                <p className="st-p">An email is enough — Sage keeps a wallet for you. Or sign in with a wallet you already have. Either way it is just your account; nothing moves.</p>
                <EmailSignIn onSignedIn={() => router.refresh()} />
                <div className="st-or"><span>or a wallet you already have</span></div>
              </>
            ) : (
              <p className="st-p">A free signature from a wallet you already have. It authorizes no transaction and moves no funds — it is just your account.</p>
            )}
            <FounderSignIn explainer={<>Ethereum or Starknet — whichever you use. You can bind the other later in Settings.</>} onSignedIn={() => router.refresh()} />
            <p className="st-foot"><Lock size={12} /> Sage never holds your keys. Work is funded from a vault it cannot exceed.</p>
          </div>
        )}

        {step === 2 && (
          <div className="st-pane" key="s2">
            <h1 className="st-h1">What are you here to do?</h1>
            <p className="st-p">Signed in as <span className="mono">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ""}</span>.</p>
            <div className="st-choices ws-stagger">
              <button className="st-choice" onClick={() => router.push("/workspace/autopilot")}>
                <span className="st-choice-ic"><Compass size={18} /></span>
                <span className="st-choice-t">Let Sage run it</span>
                <span className="st-choice-s">Fund once and stop deciding. Sage picks the work, designs it, pays for it and tells you why — inside ceilings you set.</span>
                <ChevronRight size={16} className="st-choice-arrow" />
              </button>
              <button className="st-choice" onClick={() => setIntent("pay")}>
                <span className="st-choice-ic"><Users size={18} /></span>
                <span className="st-choice-t">Pay my people for work</span>
                <span className="st-choice-s">A workspace for your team, contractors or grantees. Invite them, post the work, fund it once — Sage verifies and pays.</span>
                <ChevronRight size={16} className="st-choice-arrow" />
              </button>
              <button className="st-choice" onClick={() => (hasMemberships ? router.push("/workspace") : setIntent("earn"))}>
                <span className="st-choice-ic"><Briefcase size={18} /></span>
                <span className="st-choice-t">Get paid for work</span>
                <span className="st-choice-s">Join a team with the invite link you were sent, or pick open work from the board.</span>
                <ChevronRight size={16} className="st-choice-arrow" />
              </button>
              <button className="st-choice" onClick={() => router.push("/launch")}>
                <span className="st-choice-ic"><FlaskConical size={18} /></span>
                <span className="st-choice-t">Test my product</span>
                <span className="st-choice-s">Sage inspects your product itself, designs paid test missions, and pays the testers you fund.</span>
                <ChevronRight size={16} className="st-choice-arrow" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && intent === "pay" && (
          <div className="st-pane" key="s3pay">
            <h1 className="st-h1">Name your workspace</h1>
            <p className="st-p">Your team, programme or company. Free for you and two people; rename it any time.</p>
            <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kingston Market Co-op" maxLength={60} disabled={busy} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && name.trim().length >= 2) void create(); }} />
            <div className="st-actions">
              <button className="sage-btn sage-btn-primary" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
                {busy ? <><Loader2 size={15} className="sage-spin2" /> Creating…</> : <>Create workspace <ArrowRight size={15} /></>}
              </button>
              <button className="st-back" onClick={() => setIntent(null)}>Back</button>
            </div>
            {err && <p className="ws-err">{err}</p>}
          </div>
        )}

        {step === 3 && intent === "earn" && (
          <div className="st-pane" key="s3earn">
            <h1 className="st-h1">Join your team</h1>
            <p className="st-p">Paste the invite link you were sent. No link yet? Open work is on the board.</p>
            <input className="ws-input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://sagepays.xyz/join/ws_inv_…" autoFocus onKeyDown={(e) => { if (e.key === "Enter") join(); }} />
            <div className="st-actions">
              <button className="sage-btn sage-btn-primary" onClick={join}>Join <ArrowRight size={15} /></button>
              <Link className="st-back" href="/marketplace">See open work instead</Link>
              <button className="st-back" onClick={() => setIntent(null)}>Back</button>
            </div>
            {err && <p className="ws-err">{err}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
