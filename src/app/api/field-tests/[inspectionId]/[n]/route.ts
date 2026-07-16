import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/field-tests/<inspectionId>/<n> — serve a Field Test screenshot from disk.
 *
 * Field Test screenshots are WRITTEN at runtime (during an inspection) to
 * public/field-tests/<id>/<n>.png. But `next start` snapshots public/ at startup and does NOT
 * serve files added afterward (a real landmine — verified in prod), so they are served through
 * this route, which reads from disk on every request. Inputs are strictly validated to prevent
 * path traversal (id = the inspection nanoid; n = a single digit, since a run captures ≤6 pages).
 */

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const N_RE = /^[0-9]$/;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ inspectionId: string; n: string }> },
): Promise<NextResponse> {
  const { inspectionId, n } = await ctx.params;
  if (!ID_RE.test(inspectionId) || !N_RE.test(n)) {
    return new NextResponse("bad request", { status: 400 });
  }
  const file = path.join(process.cwd(), "public", "field-tests", inspectionId, `${n}.png`);
  try {
    const buf = await readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
