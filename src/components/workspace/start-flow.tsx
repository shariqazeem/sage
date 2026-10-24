"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Briefcase, Check, ChevronRight, Loader2, Lock, Users } from "lucide-react";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { EmailSignIn } from "@/components/auth/email-sign-in";
import { SageMark } from "@/components/brand/sage-mark";

type Intent = "pay" | "earn";

/**
 * THE FIRST RUN (19 Oct 2026). One question per screen, and only questions that are genuinely the
 * person's to answer:
 *
 *   1. who you are (an email; a wallet if you prefer; Starknet under "more options"),
 *   2. pay people, or get paid,
 *   3. what to call your workspace (it is the name your people see on an invite),
 *
 * then the app takes over: your account, ready to fund, and the first job. No rail, no menus: a
 * person who has not started has nothing to navigate yet.
 */
export function StartFlow({
  signedIn,
  address,
  chain = null,
  hasMemberships,
  emailEnabled = false,
  next = null,
}: {
  signedIn: boolean;
  address: string | null;
  chain?: "evm" | "starknet" | null;
  hasMemberships: boolean;
  emailEnabled?: boolean;
  /** Where to go once signed in, when they came from somewhere specific (the pricing page). */
  next?: string | null;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [moreOptions, setMoreOptions] = useState(false);

  const step = !signedIn ? 1 : !intent ? 2 : 3;
  const signedInNow = () => (next ? router.push(next) : router.refresh());

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
      // Home asks for the one next step (open or fund the account, then the first job). A Starknet
      // sign-in can't hold an account, so it goes straight to posting work.
      router.push(chain === "starknet" ? "/launch" : "/workspace");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    const code = invite.trim().split("/").pop()?.split("?")[0] ?? "";
    if (!code.startsWith("ws_inv_")) {
      setErr("Paste the whole invite link. It ends in ws_inv_…");
      return;
    }
    router.push(`/join/${code}`);
  };

  return (
    <main className="st-shell">
      <Link href="/" className="st-brand" aria-label="Sage home"><SageMark size={24} /><span>Sage</span></Link>
      <ol className="st-dots" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => (
          <li key={n} className={step === n ? "on" : step > n ? "done" : ""} aria-current={step === n ? "step" : undefined}>
            {step > n ? <Check size={10} /> : null}
          </li>
        ))}
      </ol>

      <div className="st-card">
        {step === 1 && (
          <div className="st-pane" key="s1">
            <h1 className="st-h1">Welcome to Sage</h1>
            {emailEnabled ? (
              <>
                <p className="st-p">Sign in with your email. Sage keeps an account for you, and nothing moves until you say so.</p>
                <EmailSignIn onSignedIn={signedInNow} />
                <div className="st-or"><span>or use a wallet</span></div>
              </>
            ) : (
              <p className="st-p">Sign in with a wallet you already have. It&apos;s one free signature: no transaction, no funds move.</p>
            )}
            <FounderSignIn
              families={moreOptions ? "all" : "evm"}
              explainer={moreOptions ? <>Ethereum or Starknet. Payments run on Metis; Starknet is for private payouts.</> : <>Any Ethereum wallet. Payments run on Metis.</>}
              onSignedIn={signedInNow}
            />
            {!moreOptions && (
              <button type="button" className="st-back st-more" onClick={() => setMoreOptions(true)}>More sign-in options</button>
            )}
            <p className="st-foot"><Lock size={12} /> Sage never holds your keys. Work is paid from a vault it can&apos;t overspend.</p>
          </div>
        )}

        {step === 2 && (
          <div className="st-pane" key="s2">
            <h1 className="st-h1">What brings you to Sage?</h1>
            <p className="st-p">
              Signed in as <span className="mono">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ""}</span>. You can do both later.
            </p>
            <div className="st-choices">
              <button className="st-choice" onClick={() => setIntent("pay")}>
                <span className="st-choice-ic"><Users size={18} /></span>
                <span className="st-choice-t">Pay people for work</span>
                <span className="st-choice-s">Product testing, gigs, bounties and milestone grants. Sage checks the work and pays.</span>
                <ChevronRight size={16} className="st-choice-arrow" />
              </button>
              <button className="st-choice" onClick={() => (hasMemberships ? router.push("/workspace") : setIntent("earn"))}>
                <span className="st-choice-ic"><Briefcase size={18} /></span>
                <span className="st-choice-t">Get paid for work</span>
                <span className="st-choice-s">Find open work, or join a team with the link you were sent. Always free.</span>
                <ChevronRight size={16} className="st-choice-arrow" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && intent === "pay" && (
          <div className="st-pane" key="s3pay">
            <h1 className="st-h1">Name your workspace</h1>
            <p className="st-p">Your company, team or programme. It&apos;s the name people see when you invite them.</p>
            <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Labs" maxLength={60} disabled={busy} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && name.trim().length >= 2) void create(); }} />
            <div className="st-actions">
              <button className="sage-btn sage-btn-primary" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
                {busy ? <><Loader2 size={15} className="sage-spin2" /> Setting up…</> : <>Continue <ArrowRight size={15} /></>}
              </button>
              <button className="st-back" onClick={() => setIntent(null)}>Back</button>
            </div>
            <p className="st-foot">You start on Free: one live job at a time, real money, real people.</p>
            {err && <p className="ws-err">{err}</p>}
          </div>
        )}

        {step === 3 && intent === "earn" && (
          <div className="st-pane" key="s3earn">
            <h1 className="st-h1">Find your first paid work</h1>
            <p className="st-p">Open work is on the board, paid in USDC to your own wallet. Were you sent an invite? Paste it here.</p>
            <div className="st-actions">
              <Link className="sage-btn sage-btn-primary" href="/marketplace">See open work <ArrowRight size={15} /></Link>
            </div>
            <div className="st-or"><span>or join a team</span></div>
            <input className="ws-input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://sagepays.xyz/join/ws_inv_…" onKeyDown={(e) => { if (e.key === "Enter") join(); }} />
            <div className="st-actions">
              <button className="sage-btn" onClick={join} disabled={!invite.trim()}>Join</button>
              <button className="st-back" onClick={() => setIntent(null)}>Back</button>
            </div>
            {err && <p className="ws-err">{err}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
