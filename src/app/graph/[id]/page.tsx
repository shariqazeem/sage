import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/db/campaigns";
import { WalletGraph } from "@/components/live/wallet-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCampaign(id);
  return { title: c ? `Wallet graph · ${c.title}` : "Wallet graph" };
}

/** PUBLIC. Every edge is an on-chain fact or a link the watch recorded; the picture is the ledger's. */
export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCampaign(id);
  if (!c || c.sandbox) notFound();
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <Link href="/explorer" className="ws-back">← Explorer</Link>
          <span className="ws-eyebrow" style={{ marginTop: 10 }}>The ledger, as a picture</span>
          <h1 className="ws-title">{c.title}</h1>
          <p className="ws-sub">Who the vault paid, who funded whose gas, and whose payouts met. A linked cluster is one person&rsquo;s wallets; the agent holds every payout in it.</p>
        </div>
      </header>
      <WalletGraph campaignId={c.id} />
    </main>
  );
}
