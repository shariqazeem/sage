import { NextResponse, type NextRequest, after } from "next/server";

import { authenticateAgent, agentError } from "@/lib/agent-api/auth";
import { opStartInspection } from "@/lib/agent-api/operations";
import { runInspectionJob } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/inspections — the ClawUp agent starts a REAL product inspection on a
 * founder's behalf. Same SSRF-guarded, idempotent operation the MCP `sage_start_inspection`
 * tool runs; it PREPARES a plan and NEVER deploys, funds, signs, or settles. `clientRef`
 * (e.g. the founder's chat id) namespaces idempotency. The founder later approves + funds at
 * `approvalUrl` — only their own wallet can.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return agentError("Invalid JSON body.", 400);
  }

  const result = opStartInspection(
    {
      productUrl: body.productUrl,
      repoUrl: body.repoUrl,
      goal: body.goal,
      targetUsers: body.targetUsers,
      budgetUsd: body.budgetUsd,
    },
    body.clientRef,
  );
  if (!result.ok) return agentError(result.error, result.status);

  if (result.created) after(() => runInspectionJob(result.inspectionId));
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
