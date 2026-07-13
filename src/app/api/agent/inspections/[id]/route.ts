import { NextResponse, type NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/agent-api/auth";
import { getInspectionJob } from "@/lib/db/inspection";
import { jobToView } from "@/lib/launch/job";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/inspections/[id] — poll a durable inspection. Returns the real stage, an
 * honest needs-input / failure state, and when ready a concise ProductMap + mission-plan
 * summary plus the founder approval link. Read-only; exposes no founder-private data.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = authenticateAgent(req);
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  const job = getInspectionJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "Inspection not found." }, { status: 404 });

  const v = jobToView(job);
  const ready = v.status === "ready";
  // `plan` is the serialized MissionPlanV1 (typed `unknown`) — narrow to the fields we expose.
  const p = v.plan as {
    missions?: Array<{ title: string; objective: string; rewardBase: string; maxCompletions: string }>;
    totalBudgetBase?: string;
  } | null;
  const plan =
    ready && p && Array.isArray(p.missions)
      ? {
          missionCount: p.missions.length,
          totalBudgetBase: p.totalBudgetBase ?? null,
          missions: p.missions.map((m) => ({
            title: m.title,
            objective: m.objective,
            rewardBase: m.rewardBase,
            maxCompletions: m.maxCompletions,
          })),
        }
      : null;

  return NextResponse.json({
    ok: true,
    inspectionId: v.id,
    stage: v.status,
    ready,
    productUrl: v.productUrl,
    pagesInspected: v.pagesInspected,
    needsInput: v.status === "needs_input" ? (v.result?.questions ?? []) : null,
    failure: v.status === "failed" ? v.failureReason : null,
    plan,
    approvalUrl: `${siteUrl()}/launch/${v.id}`,
    approvalNote: ready
      ? "Send the founder approvalUrl. Only their wallet can approve, edit, and fund the campaign — the agent cannot."
      : null,
  });
}
