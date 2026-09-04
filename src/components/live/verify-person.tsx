"use client";

import { useEffect, useState } from "react";
import { IDKitRequestWidget, orbLegacy, type RpContext } from "@worldcoin/idkit";
import { BadgeCheck, ShieldCheck } from "lucide-react";

/**
 * ONE PERSON, ONE WORKER.
 *
 * A wallet is free to create, so a wallet has never been a person — that is the whole reason the
 * first open gig was taken ten times by one operator. This proves a distinct human is behind this
 * wallet without asking who they are: the provider returns a number that is the same every time
 * that person proves and different for everyone else. No name, no document, no country.
 *
 * The consequence is stated plainly rather than hidden: verifying a second wallet as the same person
 * links them, because that is the truth the ledger should hold.
 */
interface State {
  available: boolean;
  verified: boolean;
  level: string | null;
  tier: string;
  reason: string;
}

export function VerifyPerson({ wallet }: { wallet: string }) {
  const [st, setSt] = useState<State | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ app_id: string; action: string; rp_context: RpContext } | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`/api/identity?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      if (r.ok) setSt((await r.json()) as State);
    } catch {
      /* the card simply does not appear */
    }
  };
  useEffect(() => { void load(); }, [wallet]);
  // the signed context comes from the server; without it the widget cannot be opened and is not shown
  useEffect(() => {
    let alive = true;
    void fetch("/api/identity/context", { cache: "no-store" })
      .then(async (r) => { if (r.ok && alive) setCtx((await r.json()) as { app_id: string; action: string; rp_context: RpContext }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const onProof = async (proof: unknown) => {
    setErr(null);
    try {
      const r = await fetch("/api/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof }),
      });
      const j = (await r.json()) as { message?: string; error?: string };
      if (!r.ok) setErr(j.error ?? "That didn't verify.");
      else setMsg(j.message ?? "Verified.");
      await load();
    } catch {
      setErr("Couldn't reach the verifier.");
    }
  };

  if (!st?.available || !ctx) return null;

  if (st.verified) {
    return (
      <div className="vp verified">
        <p className="vp-t"><BadgeCheck size={15} /> A verified person works from this wallet</p>
        <p className="vp-s">
          Every tier of paid work is open to you{st.level ? ` · proved at ${st.level}` : ""}. Nothing about who you
          are was stored — only a number that proves you are not two people.
        </p>
      </div>
    );
  }

  return (
    <div className="vp">
      <div className="vp-main">
        <p className="vp-t"><ShieldCheck size={15} /> Prove you are one person</p>
        <p className="vp-s">
          {msg ?? "A wallet is free to make, so it has never proved anything. Verify once and the better-paid work opens — no name, no document, no country. If the same person verifies from a second wallet, the two count as one worker."}
        </p>
        {err && <p className="vp-e">{err}</p>}
      </div>
      <button type="button" className="nm-btn" onClick={() => setOpen(true)}>Verify once</button>
      <IDKitRequestWidget
        open={open}
        onOpenChange={setOpen}
        app_id={ctx.app_id as `app_${string}`}
        action={ctx.action}
        rp_context={ctx.rp_context}
        allow_legacy_proofs
        preset={orbLegacy({ signal: wallet })}
        handleVerify={async (result: unknown) => { await onProof(result); }}
        onSuccess={() => setOpen(false)}
      />
    </div>
  );
}
