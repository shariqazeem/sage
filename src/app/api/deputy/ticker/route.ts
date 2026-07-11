import { NextResponse } from "next/server";
import { listRecentEvents } from "@/lib/db/campaigns";
import { decodeDetail } from "@/lib/campaigns/journal";
import { short } from "@/lib/format";
import type { CampaignEvent } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const usd = (base: number) => `$${(base / 1_000_000).toFixed(2)}`;

/** One terminal line per real event — verb + the honest details it already holds. */
function line(e: CampaignEvent): string | null {
  const text = decodeDetail(e.detail ?? "").text ?? e.detail ?? "";
  const first = text.split(" · ")[0] ?? "";
  const tx = e.txHash ? short(e.txHash) : "";
  const amt = e.amount != null ? usd(e.amount) : "";
  switch (e.kind) {
    case "settled":
    case "autopay_settled":
      return `SETTLE ${amt} → ${first} ${tx}`.replace(/\s+/g, " ").trim();
    case "blocked":
      return `BLOCK ${amt}${e.failedCheckIndex ? ` · check ${e.failedCheckIndex}` : ""} ${tx}`
        .replace(/\s+/g, " ")
        .trim();
    case "autopay_held":
      return `HOLD ${text}`.trim();
    case "decision_recorded":
      return `DECIDE ${text}`.trim();
    default:
      return null;
  }
}

/**
 * GET /api/deputy/ticker — the real journal, newest first, formatted for the
 * terminal strip atop /app. Sandbox events are already excluded upstream
 * (listRecentEvents). Empty when nothing has happened — the feed says nothing
 * rather than inventing activity (CLAUDE.md §5).
 */
export async function GET() {
  const lines = listRecentEvents(24)
    .map((e) => ({ id: e.id, at: e.createdAt, text: line(e) }))
    .filter((l): l is { id: string; at: number; text: string } => !!l.text);
  return NextResponse.json(
    { lines },
    { headers: { "Cache-Control": "public, max-age=5, s-maxage=5" } },
  );
}
