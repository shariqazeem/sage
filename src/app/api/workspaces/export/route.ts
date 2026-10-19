import { NextResponse, type NextRequest } from "next/server";
import { getFounderAddress } from "@/lib/auth/founder";
import { effectivePlan } from "@/lib/plans/founder-plan";
import { cheapestWith, hasFeature, PLANS, type Feature } from "@/lib/plans/catalog";
import { fraudCsv, payoutsCsv } from "@/lib/plans/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: Record<string, { feature: Feature; build: (founder: string) => string; file: string }> = {
  payouts: { feature: "exports", build: payoutsCsv, file: "sage-payouts" },
  fraud: { feature: "fraudReports", build: fraudCsv, file: "sage-fraud-report" },
};

/** GET ?kind=payouts|fraud — a CSV of the signed-in founder's own jobs, on the plans that include it. */
export async function GET(req: NextRequest) {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const kind = KINDS[req.nextUrl.searchParams.get("kind") ?? "payouts"];
  if (!kind) return NextResponse.json({ error: "Export payouts or fraud." }, { status: 400 });
  if (!hasFeature(effectivePlan(founder), kind.feature)) {
    const need = cheapestWith(kind.feature);
    return NextResponse.json({ error: `This export is on ${PLANS[need].name} and above.`, upgrade: need }, { status: 402 });
  }
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(kind.build(founder), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind.file}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
