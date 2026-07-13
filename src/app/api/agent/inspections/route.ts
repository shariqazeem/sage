import { NextResponse, type NextRequest, after } from "next/server";

import { authenticateAgent, agentError } from "@/lib/agent-api/auth";
import { startInspection } from "@/lib/launch/start";
import { runInspectionJob } from "@/lib/launch/job";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/inspections — the ClawUp agent starts a REAL product inspection on a
 * founder's behalf. Same SSRF-guarded, idempotent pipeline as the web `POST /api/launch`;
 * it PREPARES a plan and NEVER deploys, funds, signs, or settles. `clientRef` (e.g. the
 * founder's chat id) namespaces idempotency so repeat calls return the same inspection.
 * The founder later approves + funds in the web app at `approvalUrl` — only their wallet can.
 */
function slugRef(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "shared";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return agentError("Invalid JSON body.", 400);
  }

  const clientRef =
    typeof body.clientRef === "string" && body.clientRef.trim() ? slugRef(body.clientRef) : "shared";

  const result = startInspection({
    productUrl: body.productUrl,
    repoUrl: body.repoUrl,
    goal: body.goal,
    targetUsers: body.targetUsers,
    budgetUsd: body.budgetUsd,
    founder: `clawup:${clientRef}`,
  });
  if (!result.ok) return agentError(result.error, 400);

  if (result.created) after(() => runInspectionJob(result.job.id));

  const base = siteUrl();
  return NextResponse.json(
    {
      ok: true,
      inspectionId: result.job.id,
      created: result.created,
      statusUrl: `${base}/api/agent/inspections/${result.job.id}`,
      approvalUrl: `${base}/launch/${result.job.id}`,
      note: "Poll statusUrl until stage is 'ready'. Then give the founder approvalUrl — only their own wallet can approve, edit, and fund the campaign in the Sage web app.",
    },
    { status: result.created ? 201 : 200 },
  );
}
