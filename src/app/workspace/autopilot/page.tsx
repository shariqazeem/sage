import "../../app/app.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import Link from "next/link";
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
          <p className="ws-sub">
            Fund a treasury once and name your product. From then on Sage decides what work to buy
            against it, designs the missions, funds them, judges every submission and pays — inside
            ceilings it cannot exceed. It proposes each move with its reason before the money leaves,
            and you can stop any of them. Posting work yourself keeps working exactly as it does now.
          </p>
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
            <ul className="ws-list">
              <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">Spend past your ceilings</span></p><p className="ws-row-meta">The week, a single campaign, and a reserve floor you keep. The vault enforces the payout side on-chain.</p></div></li>
              <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">Buy work anywhere you did not name</span></p><p className="ws-row-meta">It may only choose among your product and surfaces it has already worked. An invented address is refused, not corrected.</p></div></li>
              <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">Decide its own prices</span></p><p className="ws-row-meta">A model picks what to buy. The amount is computed from your ceilings and what past work actually returned.</p></div></li>
              <li className="ws-row"><div className="ws-row-main"><p className="ws-row-title"><span className="t">Move before you can object</span></p><p className="ws-row-meta">Every move waits out a window you set, and anything unspent can only return to your own wallet.</p></div></li>
            </ul>
            <p className="ws-note">
              Prefer to choose the work yourself? <Link href="/launch">Post work</Link> — nothing here changes that.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
