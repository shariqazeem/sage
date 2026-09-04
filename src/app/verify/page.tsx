import "../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import Link from "next/link";
import type { Metadata } from "next";
import { VerifyGate } from "@/components/live/verify-gate";
import { getFounderAddress } from "@/lib/auth/founder";
import { worldIdConfig } from "@/lib/identity/worldid";
import { identityCount } from "@/lib/db/identity";
import { openTierCeilingBase } from "@/lib/identity/tier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prove you are one person",
  description:
    "Verify once and the better-paid work opens. No name, no document, no country — only a number that proves you are not two people.",
};

/**
 * THE DOOR, WHERE PEOPLE CAN ACTUALLY REACH IT.
 *
 * Verification existed only on a worker's own record page, which they reach from a proof receipt or
 * a docs example — nowhere a person who WANTS to verify would ever look. A capability nobody can
 * find is a capability nobody has, so this is the one address that can be linked from a campaign, a
 * message, or the board.
 */
export default async function VerifyPage() {
  const armed = worldIdConfig() !== null;
  const wallet = await getFounderAddress();
  const { people, wallets } = identityCount();
  const ceiling = `$${(openTierCeilingBase() / 1e6).toFixed(2)}`;
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">One person, one worker</span>
          <h1 className="ws-title">Prove you are one person</h1>
          <p className="ws-sub">
            A wallet costs nothing to create, so a wallet has never proved anything — which is how one
            operator took ten of ten slots on an open gig with twelve of them. Verifying takes a
            minute and asks for no name, no document and no country. What it returns is a single
            number that is the same every time you prove and different for everyone else.
          </p>
        </div>
      </header>

      {armed ? (
        <VerifyGate wallet={wallet} />
      ) : (
        <section className="ws-card">
          <div className="ws-card-h"><h2>Not switched on here yet</h2></div>
          <p className="ws-note">
            Verification is not armed on this deployment. Work paying {ceiling} or less is open to
            anyone in the meantime, and standing is earned by doing it.
          </p>
        </section>
      )}

      <div className="ws-grid">
        <section className="ws-card">
          <div className="ws-card-h"><h2>What it changes</h2></div>
          <ul className="ws-list">
            <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">Every tier of paid work opens</span></p><p className="ws-row-meta">Work paying more than {ceiling} asks for standing first. Verifying is the fastest way to have it; the other way is finishing open work on two different campaigns.</p></div></li>
            <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">Nothing about you is stored</span></p><p className="ws-row-meta">Not a name, a document, a country or an age. Only the number, and the wallet you bound it to.</p></div></li>
            <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">An Orb scan is not required</span></p><p className="ws-row-meta">A World App account on your own device is enough, and the record shows which of the two you proved. Orb is the stronger claim; requiring it would have shut out almost everyone this work is for.</p></div></li>
            <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">A second wallet counts as the same worker</span></p><p className="ws-row-meta">Because it is. Verifying again from another wallet links the two, and they share one standing rather than doubling it. That is the point, and it is stated here rather than discovered later.</p></div></li>
          </ul>
        </section>

        <section className="ws-card">
          <div className="ws-card-h"><h2>Where it stands</h2></div>
          <p className="ws-note">
            {wallets === 0
              ? "No one has verified here yet. You would be the first."
              : `${people} ${people === 1 ? "person has" : "people have"} verified, across ${wallets} ${wallets === 1 ? "wallet" : "wallets"}.`}
          </p>
          <p className="ws-note">
            Not sure this is for you? <Link href="/marketplace">See the open work</Link> — anything at
            or under {ceiling} is claimable without verifying at all.
          </p>
        </section>
      </div>
    </main>
  );
}
