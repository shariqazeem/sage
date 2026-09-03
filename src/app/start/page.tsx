import "../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/wallet-connect.css";
import "@/styles/workspace.css";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { StartFlow } from "@/components/workspace/start-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Get started", description: "Sign in, say what you're here to do, and Sage sets up your workspace." };

/**
 * THE ONE DOOR. Sign in → say what you are here to do → land in the right place. A founder who
 * already has a workspace never sees this again; a member goes to their work; a stranger with
 * nothing yet names a workspace. Three screens at most, one question each.
 */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const ctx = await workspaceContext();
  if (ctx?.owned) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/workspace");
  return <StartFlow signedIn={!!ctx} address={ctx?.address ?? null} hasMemberships={(ctx?.memberships.length ?? 0) > 0} />;
}
