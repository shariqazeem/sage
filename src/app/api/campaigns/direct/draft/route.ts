import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getFounderAddress } from "@/lib/auth/founder";
import { draftDirectCampaign } from "@/lib/launch/gig-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  intent: z.string().min(10).max(1200),
  productUrl: z.string().url().max(400).refine((u) => u.startsWith("https://"), "https only").optional(),
});

/**
 * Draft a direct campaign's brief from the founder's sentence — words only. The founder sets the
 * money in the composer and the deterministic compiler (POST /api/campaigns/direct) does the rest.
 * Signed-in founders only: a draft is a model call, and the same "create" limiter guards it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Sign in with your wallet to let Sage draft this." }, { status: 401 });
  const rl = rateLimit("create", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Describe the work in a sentence or two first." }, { status: 400 });
  const r = await draftDirectCampaign({ intent: parsed.data.intent, productUrl: parsed.data.productUrl ?? null });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 503 });
  return NextResponse.json({ ok: true, draft: r.draft, notes: r.notes, model: r.model });
}
