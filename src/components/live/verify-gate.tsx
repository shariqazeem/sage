"use client";

import { useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { VerifyPerson } from "./verify-person";

/**
 * WHICH WALLET IS THIS FOR.
 *
 * The proof binds to one wallet — the one that gets paid — so the page has to know which before it
 * can offer anything. A worker here may have arrived from a Telegram link with no browser wallet at
 * all, so this asks for the address rather than demanding a wallet connection: they can paste the
 * one from their work record, and nothing is signed on this page.
 */
export function VerifyGate() {
  const [input, setInput] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = () => {
    const w = input.trim();
    if (!/^0x[0-9a-fA-F]{20,64}$/.test(w)) {
      setErr("That doesn't look like a wallet address. It starts 0x and is the one you get paid at.");
      return;
    }
    setErr(null);
    setWallet(w);
  };

  if (wallet) {
    return (
      <>
        <VerifyPerson wallet={wallet} />
        <p className="ws-note" style={{ marginTop: 0 }}>
          Verifying <span className="mono">{wallet.slice(0, 10)}…{wallet.slice(-6)}</span> ·{" "}
          <button type="button" className="vg-link" onClick={() => setWallet(null)}>use a different wallet</button>
          {" · "}
          <Link href={`/record/${wallet}`}>see its work record</Link>
        </p>
      </>
    );
  }

  return (
    <section className="ws-card">
      <div className="ws-card-h"><h2><Wallet size={15} /> Which wallet gets paid?</h2></div>
      <p className="ws-note" style={{ margin: "0 0 12px" }}>
        Paste the address you are paid at. Nothing is signed here, and the proof binds to this wallet
        alone.
      </p>
      <div className="vg-row">
        <input
          className="ws-input mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder="0x…"
          aria-label="Your wallet address"
          spellCheck={false}
        />
        <button type="button" className="nm-btn" onClick={go}>Continue</button>
      </div>
      {err && <p className="mc-err">{err}</p>}
    </section>
  );
}
