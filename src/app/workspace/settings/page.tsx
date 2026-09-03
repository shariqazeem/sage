import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { listPlanPayments } from "@/lib/db/workspaces";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { limitsOf, planOf, proPriceUsd } from "@/lib/workspaces/plan";
import { founderChain } from "@/lib/auth/founder";
import { SettingsPanel } from "@/components/workspace/settings-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start?next=/workspace/settings");
  if (!ctx.owned) redirect("/workspace");
  const ws = ctx.owned;
  const linked = linkedWalletsOf(ctx.address).filter((w) => w.toLowerCase() !== ctx.address.toLowerCase());
  return (
    <SettingsPanel
      workspace={{ id: ws.id, name: ws.name, plan: planOf(ws), planUntil: ws.planUntil, memberCap: limitsOf(ws).members, proPriceUsd: proPriceUsd() }}
      account={{ address: ctx.address, chain: founderChain(ctx.address) ?? "evm", linked: linked.map((w) => ({ address: w, chain: founderChain(w) ?? "evm" })) }}
      payments={listPlanPayments(ws.id).map((p) => ({ txHash: p.txHash, amountUsd: p.amountBase / 1e6, paidAt: p.paidAt, planUntil: p.planUntil }))}
    />
  );
}
