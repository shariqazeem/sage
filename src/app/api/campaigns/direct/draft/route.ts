import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getFounderAddress } from "@/lib/auth/founder";
import { draftDirectCampaign } from "@/lib/launch/gig-draft";
import { readHandedOver } from "@/lib/launch/handed-over";
import { wordsOnly } from "@/lib/launch/hand-over-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  intent: z.string().min(10).max(1200),
  productUrl: z.string().url().max(400).refine((u) => u.startsWith("https://"), "https only").optional(),
});

/**
 * Draft a direct campaign's brief from what the founder handed over — words only. A link in it (an
 * issue, a doc, a page) is opened and read first (handed-over.ts), and the answer says whether it was,
 * so Post can show what Sage actually did. The founder sets the money in the composer and the
 * deterministic compiler (POST /api/campaigns/direct) does the rest. Signed-in founders only: a draft
 * is a model call, and the same "create" limiter guards it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getFounderAddress();
  if (!session) return NextResponse.json({ ok: false, error: "Sign in (email or MetaMask) to let Sage draft this." }, { status: 401 });
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
  const handed = await readHandedOver(parsed.data.intent);
  const source = handed ? { url: handed.url, label: handed.label, read: handed.read, reason: handed.reason } : null;
  // a link Sage could not open, with no words beside it, is nothing to draft from: ask for the words
  if (handed && !handed.read && wordsOnly(parsed.data.intent).length < 12) {
    return NextResponse.json(
      { ok: false, error: `Sage couldn't open ${handed.label}: ${handed.reason}. Paste what it says, or describe the work in a few words.`, source },
      { status: 422 },
    );
  }
  const r = await draftDirectCampaign({
    intent: parsed.data.intent,
    productUrl: handed?.read ? null : (parsed.data.productUrl ?? null),
    source: handed?.read ? { url: handed.url, text: handed.text } : null,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, source }, { status: 503 });
  return NextResponse.json({ ok: true, draft: r.draft, notes: r.notes, model: r.model, source });
}
