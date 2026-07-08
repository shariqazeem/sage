import { NextResponse } from "next/server";
import { clearSession, getSessionAddress } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I — the authenticated wallet, or null. */
export async function GET() {
  return NextResponse.json({ address: await getSessionAddress() });
}

/** Log out. */
export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
