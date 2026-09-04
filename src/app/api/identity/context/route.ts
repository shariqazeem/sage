import { NextResponse } from "next/server";
import { worldIdConfig, worldIdContext } from "@/lib/identity/worldid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed request context the verification widget needs. The signing key stays here; the browser
 * receives only a nonce, a validity window and a signature over them, so a proof produced with it
 * cannot be replayed against another app.
 */
export async function GET() {
  const cfg = worldIdConfig();
  if (!cfg) return NextResponse.json({ available: false }, { status: 404 });
  const ctx = await worldIdContext(cfg).catch(() => null);
  if (!ctx) return NextResponse.json({ available: false, reason: "signing key not configured" }, { status: 404 });
  return NextResponse.json({ available: true, app_id: cfg.appId, action: cfg.action, rp_context: ctx });
}
