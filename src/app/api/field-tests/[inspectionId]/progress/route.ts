import { NextResponse, type NextRequest } from "next/server";
import { readFieldTestProgress } from "@/lib/launch/field-test-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/field-tests/<inspectionId>/progress — the live trail of what Sage is doing in the
 * browser right now: one entry per state it has ACTUALLY captured, newest last.
 *
 * Read-only and cheap, so the inspecting page can poll it while the field test runs. Returns an
 * empty list (never an error) when there is no trail yet — the browser phase may not have started,
 * or this run may be static-only. A static segment, so it takes precedence over the sibling
 * `[n]` screenshot route.
 */

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ inspectionId: string }> },
): Promise<NextResponse> {
  const { inspectionId } = await ctx.params;
  if (!ID_RE.test(inspectionId)) {
    return NextResponse.json({ ok: false, steps: [] }, { status: 400 });
  }
  const steps = await readFieldTestProgress(inspectionId);
  return NextResponse.json(
    { ok: true, steps },
    { headers: { "cache-control": "no-store" } },
  );
}
