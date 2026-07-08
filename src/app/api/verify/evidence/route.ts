import { NextResponse, type NextRequest } from "next/server";
import { validateEvidenceUrl } from "@/lib/campaigns/validate";
import { fetchEvidence } from "@/lib/deputy/evidence";
import { withX402Paywall } from "@/lib/x402/middleware";
import { VERIFICATION_FEE_USD } from "@/lib/x402/facilitator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RAIL 1 — the gated evidence-verification resource. Fetches + normalizes an
 * evidence URL (SSRF-validated). Behind the x402 paywall: when the rail is live
 * the Deputy must pay 0.1 USDC to reach it; when not live the paywall bypasses
 * and the internal caller reaches it directly (tagged `x-x402: bypass`).
 */
async function handler(req: NextRequest): Promise<Response> {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, text: "", contentSha256: null, failReason: "invalid body" },
      { status: 400 },
    );
  }
  const v = validateEvidenceUrl(body.url);
  if (!v.ok) {
    return NextResponse.json({
      ok: false,
      text: "",
      contentSha256: null,
      failReason: v.error,
    });
  }
  const ev = await fetchEvidence(v.value);
  return NextResponse.json({
    text: ev.text,
    contentSha256: ev.contentSha256,
    ok: ev.ok,
    failReason: ev.failReason ?? null,
  });
}

const paywalled = withX402Paywall(handler, {
  amountUsd: VERIFICATION_FEE_USD,
  symbol: "USDC",
});

export function POST(req: NextRequest): Promise<Response> | Response {
  return paywalled(req);
}
