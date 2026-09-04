"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import { VerifyPerson } from "./verify-person";

/**
 * A PROOF IS ONLY WORTH RECORDING AGAINST A WALLET YOU CONTROL.
 *
 * This asked people to paste an address, which let anyone bind a proof to a wallet that was not
 * theirs — a proof of personhood without a proof of control states nothing useful, since the PAIR is
 * the claim. The submit door beside it already derived the wallet from the session and required a
 * signature; identity was the one place held to a weaker standard than the money path.
 *
 * So there is no address field. Signing in is how a person shows the wallet is theirs, the proof is
 * how they show they are one person, and the server reads the wallet from the session either way.
 */
export function VerifyGate({ wallet, lede = true }: { wallet: string | null; lede?: boolean }) {
  if (!wallet) {
    return (
      <section className="ws-card">
        <div className="ws-card-h"><h2><LogIn size={15} /> Sign in with the wallet you get paid at</h2></div>
        <p className="ws-note" style={{ margin: "0 0 14px" }}>
          A proof binds to a wallet, so it is read from your sign-in rather than typed. An email is
          enough — Sage keeps the wallet, and it is the same address that receives your payouts.
        </p>
        <div className="mc-actions">
          <Link href="/start" className="nm-btn">Sign in</Link>
          <Link href="/marketplace" className="nm-btn ghost">See the open work first</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <VerifyPerson wallet={wallet} lede={lede} />
      <p className="ws-note" style={{ marginTop: 0 }}>
        The wallet you are signed in with. <Link href={`/record/${wallet}`}>See its work record</Link>.
      </p>
    </>
  );
}
