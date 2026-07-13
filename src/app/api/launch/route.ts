import { NextResponse, type NextRequest, after } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { startInspection } from "@/lib/launch/start";
import { runInspectionJob, jobToView } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch — start a founder-launch inspection. Delegates to the shared
 * {@link startInspection} (SSRF-guarded validation + durable idempotent job creation),
 * then runs the real pipeline AFTER the response so the founder can poll true progress.
 * Never deploys or funds. Founder identity is the SIWE session wallet, or an anonymous
 * namespace pre-wallet (the real owner is set when they claim the plan).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const session = await getSessionAddress();
  const result = startInspection({
    productUrl: body.productUrl,
    repoUrl: body.repoUrl,
    goal: body.goal,
    targetUsers: body.targetUsers,
    budgetUsd: body.budgetUsd,
    founder: session ?? "anonymous",
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // run the REAL pipeline after responding; the founder polls /api/launch/<id>.
  if (result.created) after(() => runInspectionJob(result.job.id));

  return NextResponse.json(
    { ok: true, job: jobToView(result.job), created: result.created },
    { status: result.created ? 201 : 200 },
  );
}
