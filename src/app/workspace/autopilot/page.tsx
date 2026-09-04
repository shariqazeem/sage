import "../../app/app.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import Link from "next/link";
import { Ban } from "lucide-react";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { MandateCard } from "@/components/workspace/mandate-card";
import { NextMove } from "@/components/live/next-move";
import { TreasuryCard } from "@/components/workspace/treasury-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Let Sage run it" };

/**
 * THE AUTONOMOUS DOOR, given its own room.
 *
 * This lived under Settings, beneath the treasury, which said it was a preference rather than the
 * product. It is the product: a founder funds once and stops deciding. Settings still tunes the
 * ceilings later; this is where the decision to hand over the wheel is actually made, and where the
 * agent's next move is watched once it has been.
 */
export default async function AutopilotPage() {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start");
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Hire it once</span>
          <h1 className="ws-title">Let Sage run it</h1>
          {/* The card below says all of this in its own words; saying it twice is not emphasis. */}
          <p className="ws-sub">Fund once. Then it decides, and you can stop any move before the money leaves.</p>
        </div>
      </header>

      <NextMove />

      <div className="ws-grid">
        <div>
          <MandateCard />
        </div>
        <div>
          <TreasuryCard />
          <section className="ws-card">
            <div className="ws-card-h"><h2>What it will never do</h2></div>
            <ul className="nvr">
              <li><span className="nvr-x"><Ban size={13} /></span><b>Spend past your ceilings</b><span>The vault enforces the payout side on-chain</span></li>
              <li><span className="nvr-x"><Ban size={13} /></span><b>Buy work you did not name</b><span>An invented address is refused, not corrected</span></li>
              <li><span className="nvr-x"><Ban size={13} /></span><b>Set its own prices</b><span>The amount comes from your ceilings, not the model</span></li>
              <li><span className="nvr-x"><Ban size={13} /></span><b>Move before you can object</b><span>Every move waits out your window</span></li>
            </ul>
            <p className="ws-note">
              Rather choose the work yourself? <Link href="/launch">Post work</Link>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
