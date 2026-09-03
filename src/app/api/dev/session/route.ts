import { NextResponse, type NextRequest } from "next/server";
import { createSessionForVerifiedAddress } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT ONLY. Mints a session for an address so the signed-in surfaces can be looked at on a
 * local machine without a wallet in the browser. Returns 404 in production, unconditionally.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const a = await createSessionForVerifiedAddress(address);
  if (!a) return NextResponse.json({ error: "address required" }, { status: 400 });
  return NextResponse.redirect(new URL(req.nextUrl.searchParams.get("next") ?? "/start", req.nextUrl.origin));
}
