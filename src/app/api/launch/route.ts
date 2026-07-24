import { NextResponse, type NextRequest, after } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { startInspection } from "@/lib/launch/start";
import { webRequestIdFrom } from "@/lib/launch/planning-request";
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
  // Request-scoped identity: the browser mints one UUID per launch form (a double-submit reuses
  // it → one job; a fresh form is a fresh turn). Junk/absent → a server-minted id. Never LLM-sourced.
  const planningRequestId = webRequestIdFrom(body.requestId);
  const result = startInspection({
    productUrl: body.productUrl,
    repoUrl: body.repoUrl,
    goal: body.goal,
    targetUsers: body.targetUsers,
    budgetUsd: body.budgetUsd,
    founder: session ?? "anonymous",
    planningRequestId,
    surface: "web",
    actor: session ?? "anonymous",
  });
  if (!result.ok) {
    const status = result.error === "request_identity_mismatch" ? 409 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  // run the REAL pipeline after responding; the founder polls /api/launch/<id>.
  if (result.created) after(() => runInspectionJob(result.job.id));

  return NextResponse.json(
    { ok: true, job: jobToView(result.job), created: result.created },
    { status: result.created ? 201 : 200 },
  );
}
