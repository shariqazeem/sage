import { NextResponse, type NextRequest } from "next/server";
import { workspaceContext } from "@/lib/workspaces/context";
import { countActiveAgentKeys, listAgentKeys, revokeAgentKey } from "@/lib/db/agent-keys";
import { mintAgentKey, normaliseScopes, scopesOf } from "@/lib/agent-keys/keys";
import { effectiveWorkspacePlan } from "@/lib/plans/founder-plan";
import { cheapestWith, PLAN_ORDER, PLANS } from "@/lib/plans/catalog";
import { founderChain } from "@/lib/auth/founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE KEYS A WORKSPACE OWNER GIVES THEIR OWN AI AGENTS. GET lists them (never the keys themselves),
 * POST mints one (shown once), DELETE ?id= revokes one. Owner only: a key acts as the owner, so an
 * admin minting one would be minting the owner's authority. The plan's count is enforced here.
 */

function view(k: ReturnType<typeof listAgentKeys>[number]) {
  return { id: k.id, name: k.name, prefix: k.prefix, scopes: [...scopesOf(k)], createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt };
}

async function owner() {
  const ctx = await workspaceContext();
  if (!ctx) return { error: NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 }) };
  if (!ctx.owned) return { error: NextResponse.json({ ok: false, error: "Only a workspace's owner can connect agents to it." }, { status: 403 }) };
  return { ctx, ws: ctx.owned };
}

export async function GET() {
  const o = await owner();
  if ("error" in o) return o.error;
  const plan = effectiveWorkspacePlan(o.ws);
  return NextResponse.json({ ok: true, keys: listAgentKeys(o.ws.id).map(view), limit: PLANS[plan].agentKeys, plan });
}

export async function POST(req: NextRequest) {
  const o = await owner();
  if ("error" in o) return o.error;
  let body: { name?: unknown; scopes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) return NextResponse.json({ ok: false, error: "Give the agent a name you'll recognise, like \"Claude on my laptop\"." }, { status: 400 });
  const scopes = normaliseScopes(Array.isArray(body.scopes) ? body.scopes : []);
  // Launching spends from the Sage account, which only an Ethereum-style sign-in holds.
  if (scopes.includes("launch") && founderChain(o.ctx.address) !== "evm") {
    return NextResponse.json({ ok: false, error: "Launching from an account needs a Sage account, which opens with an email or an Ethereum wallet sign-in. Connect the agent to read and plan instead." }, { status: 400 });
  }
  const plan = effectiveWorkspacePlan(o.ws);
  const limit = PLANS[plan].agentKeys;
  if (countActiveAgentKeys(o.ws.id) >= limit) {
    const next = PLAN_ORDER.find((p) => PLANS[p].agentKeys > limit) ?? cheapestWith("roles");
    return NextResponse.json({ ok: false, code: "plan_limit", upgradeTo: next, error: `${PLANS[plan].name} connects ${limit} agent${limit === 1 ? "" : "s"} at a time. Revoke one, or move to ${PLANS[next].name} for up to ${PLANS[next].agentKeys}.` }, { status: 403 });
  }
  const minted = mintAgentKey({ workspaceId: o.ws.id, founder: o.ctx.address, name, scopes });
  return NextResponse.json({ ok: true, key: minted.key, agent: view(minted.row) });
}

export async function DELETE(req: NextRequest) {
  const o = await owner();
  if ("error" in o) return o.error;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!revokeAgentKey(o.ws.id, id)) return NextResponse.json({ ok: false, error: "No live key with that id in this workspace." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
