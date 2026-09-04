import "../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import Link from "next/link";
import type { Metadata } from "next";
import { EyeOff, KeyRound, Smartphone } from "lucide-react";
import { VerifyGate } from "@/components/live/verify-gate";
import { OnePersonFigure } from "@/components/live/one-person-figure";
import { worldIdConfig } from "@/lib/identity/worldid";
import { identityCount } from "@/lib/db/identity";
import { openTierCeilingBase } from "@/lib/identity/tier";
import { getFounderAddress } from "@/lib/auth/founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prove you are one person",
  description: "Verify once and the better-paid work opens. No name, no document, no country.",
};

/**
 * The page used to argue its case in four paragraphs. It now shows it: the figure states the whole
 * idea, three tiles carry what a reader actually needs, and the words that remain are the ones a
 * picture cannot say.
 */
export default async function VerifyPage() {
  const armed = worldIdConfig() !== null;
  const wallet = await getFounderAddress();
  const { people, wallets } = identityCount();
  const ceiling = `$${(openTierCeilingBase() / 1e6).toFixed(2)}`;
  return (
    <main className="ws-shell">
      <header className="ws-head vf-head">
        <div>
          <span className="ws-eyebrow">One person, one worker</span>
          <h1 className="ws-title">Prove you are one person</h1>
          <p className="ws-sub">Once. A minute. Then every public mission is open to you — one slot each, for everyone.</p>
        </div>
        <OnePersonFigure />
      </header>

      {armed ? (
        <VerifyGate wallet={wallet} lede={false} />
      ) : (
        <section className="ws-card">
          <div className="ws-card-h"><h2>Not switched on here yet</h2></div>
          <p className="ws-note">Work at {ceiling} or less stays open to anyone in the meantime.</p>
        </section>
      )}

      <div className="vf-grid">
        <div className="vf">
          <span className="vf-ic"><KeyRound size={15} /></span>
          <p className="vf-t">One person, one slot</p>
          <p className="vf-s">Public work asks everyone to prove they are one person before claiming, so fifty slots need fifty people. Work above {ceiling} also unlocks here.</p>
        </div>
        <div className="vf">
          <span className="vf-ic"><EyeOff size={15} /></span>
          <p className="vf-t">Stores nothing about you</p>
          <p className="vf-s">No name, document, country or age — only a number, and the wallet you bound it to.</p>
        </div>
        <div className="vf">
          <span className="vf-ic"><Smartphone size={15} /></span>
          <p className="vf-t">No Orb scan needed</p>
          <p className="vf-s">A World App account on your own device is enough. The record shows which you proved.</p>
        </div>
        <div className="vf">
          <span className="vf-num">{wallets === 0 ? "0" : people}</span>
          <span className="vf-num-k">
            {wallets === 0 ? "verified so far — be the first" : `${people === 1 ? "person" : "people"} verified, across ${wallets} ${wallets === 1 ? "wallet" : "wallets"}`}
          </span>
        </div>
      </div>

      <p className="ws-note vf-foot">
        Verifying a second wallet makes it the same worker, not a new one — that is the point.{" "}
        <Link href="/marketplace">See the open work</Link>, which needs none of this.
      </p>
    </main>
  );
}
