import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import "@/styles/live.css";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { founderChain } from "@/lib/auth/founder";
import { SettingsPanel } from "@/components/workspace/settings-panel";
import { isPlanId } from "@/lib/plans/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const sp = await searchParams;
  const preselect = isPlanId(sp.plan) ? sp.plan : null;
  const ctx = await workspaceContext();
  // Signed out: sign in and come straight back, holding the plan they picked on the pricing page.
  if (!ctx) redirect(`/start?next=${encodeURIComponent(`/workspace/settings${preselect ? `?plan=${preselect}` : ""}`)}`);
  // No workspace yet is fine here: the plan card opens one with the first payment.
  const ws = ctx.owned;
  const linked = linkedWalletsOf(ctx.address).filter((w) => w.toLowerCase() !== ctx.address.toLowerCase());
  return (
    <SettingsPanel
      workspace={ws ? { id: ws.id, name: ws.name } : null}
      preselect={preselect}
      account={{ address: ctx.address, chain: founderChain(ctx.address) ?? "evm", linked: linked.map((w) => ({ address: w, chain: founderChain(w) ?? "evm" })) }}
    />
  );
}
