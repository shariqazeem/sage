import { NextResponse, type NextRequest, after } from "next/server";

import { startInspection } from "@/lib/launch/start";
import { webRequestIdFrom } from "@/lib/launch/planning-request";
import { runInspectionJob, jobToView } from "@/lib/launch/job";
import { getFounderAddress } from "@/lib/auth/founder";

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

  /**
   * AN INSPECTION IS SIGNED-IN WORK NOW.
   *
   * It was open to anyone, and each run costs real model spend with nothing attributable at the end
   * of it: a quarter of all inspections came from `anonymous`, and when one of those people later
   * left feedback there was no way to connect the two. Requiring a signed-in wallet fixes both at
   * once — every inspection has an owner, every piece of feedback can be traced to the run it came
   * from, and the cost is bounded by something we can see.
   *
   * Signing in is a free signature: no gas, no transaction, no funds moved.
   */
  const session = await getFounderAddress();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Connect your wallet to run an inspection — it's a free signature, no gas and nothing spent." },
      { status: 401 },
    );
  }
  // Request-scoped identity: the browser mints one UUID per launch form (a double-submit reuses
  // it → one job; a fresh form is a fresh turn). Junk/absent → a server-minted id. Never LLM-sourced.
  const planningRequestId = webRequestIdFrom(body.requestId);
  const result = startInspection({
    productUrl: body.productUrl,
    repoUrl: body.repoUrl,
    goal: body.goal,
    targetUsers: body.targetUsers,
    budgetUsd: body.budgetUsd,
    // OPTIONAL test account for the founder's OWN product — sealed at the door in startInspection,
    // never logged, never echoed back in any response.
    testAccount: body.testAccount,
    founder: session,
    planningRequestId,
    surface: "web",
    actor: session,
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
