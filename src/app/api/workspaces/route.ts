import { NextResponse, type NextRequest, after } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { createWorkspace, renameWorkspace } from "@/lib/db/workspaces";
import { founderChain, founderStorageKey } from "@/lib/auth/founder";
import { createWebTreasury } from "@/lib/treasury/web";
import { accountUnavailableBecause } from "@/lib/treasury/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The cap a workspace's account opens with when nobody chose one — changeable on the account page. */
export const DEFAULT_ACCOUNT_CAP_USD = 50;

/**
 * POST { name } — create the caller's workspace (one per founder), or rename it.
 *
 * A NEW WORKSPACE OPENS ITS ACCOUNT. The sign-in door promises "Sage keeps a wallet for you"; the
 * account page then asking an email founder to open one read as a contradiction (the founder, 11 Sep
 * 2026). So the account on the default network is opened here, once, for any Ethereum-style sign-in —
 * after the response, because Privy takes several seconds (12 s measured locally) and the founder
 * should land on Home, not on a spinner. Best effort: a Privy failure logs and the manual door on the
 * account page still works. Starknet sign-ins have no reclaim address for a mandate and get no account.
 */
export async function POST(req: NextRequest) {
  const ctx = await workspaceContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "Give the workspace a name (2–60 characters)." }, { status: 400 });
  if (ctx.owned) {
    renameWorkspace(ctx.owned.id, name);
    return NextResponse.json({ ok: true, workspace: { id: ctx.owned.id, name, slug: ctx.owned.slug }, renamed: true });
  }
  const ws = createWorkspace({ name, ownerKey: founderStorageKey(ctx.address), ownerAddress: ctx.address });
  const founder = ctx.address;
  const opening = founderChain(founder) === "evm" && accountUnavailableBecause(founder) === null;
  if (opening) {
    // Privy takes several seconds; the founder should be on their Home page, not watching a spinner.
    // The account page joins the opening in flight if they get there first (see createWebTreasury).
    after(async () => {
      const started = Date.now();
      try {
        const t = await createWebTreasury(founder, DEFAULT_ACCOUNT_CAP_USD);
        console.log(`[workspaces] account opened for ${founder.slice(0, 10)}… at ${t.privyWalletAddress} in ${Date.now() - started} ms`);
      } catch (e) {
        console.warn(`[workspaces] could not open the account for ${founder.slice(0, 10)}…:`, e instanceof Error ? e.message : e);
      }
    });
  }
  return NextResponse.json({ ok: true, workspace: { id: ws.id, name: ws.name, slug: ws.slug }, renamed: false, account: { opening } });
}
