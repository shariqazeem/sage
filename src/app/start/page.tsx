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
 * THE ONE DOOR. Sign in → pay people or get paid → name the workspace → the account, ready to
 * fund → the first job. A founder who already has a workspace never sees this again; a member goes
 * to their work. No rail here: someone who has not started has nothing to navigate yet.
 */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  // Only a path on this site (never "//elsewhere"): `next` arrives in a URL anyone can craft.
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : null;
  const ctx = await workspaceContext();
  if (ctx?.owned) redirect(next ?? "/workspace");
  return (
    <StartFlow
      signedIn={!!ctx}
      address={ctx?.address ?? null}
      hasMemberships={(ctx?.memberships.length ?? 0) > 0}
      emailEnabled={!!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim()}
      next={next}
    />
  );
}
