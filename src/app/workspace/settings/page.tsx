import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
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
      workspace={{ id: ws.id, name: ws.name }}
      account={{ address: ctx.address, chain: founderChain(ctx.address) ?? "evm", linked: linked.map((w) => ({ address: w, chain: founderChain(w) ?? "evm" })) }}
    />
  );
}
