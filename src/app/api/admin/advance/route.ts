import { NextResponse, type NextRequest } from "next/server";
import { disburseAdvance } from "@/lib/advance/disburse";
import { advanceHistory } from "@/lib/db/advances";

/** cent-exact USD → 6-decimal base units — the same one-liner the direct compiler uses. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * OPERATOR-ONLY: disburse an advance against a wallet's witnessed inflow (scripts/advance.mjs).
 *
 * The first lender is us — the Sage pot — so disbursement is an operator action behind the same
 * fail-closed SAGE_ADMIN_SECRET gate as held-work review, not a public surface. What keeps it
 * honest is that the operator is bound by the SAME published arithmetic the page shows:
 * the request is refused when it exceeds `advanceCapacityUsd(signals, multiple)`, computed from
 * the live record at the moment of disbursement. Sage still scores nobody; the lender picked the
 * multiple, the formula did the rest, and both are recorded on the row.
 *
 * The advance goes out as a CLAIM LINK from the pot — the same envelope every other private payout
 * uses — so the advance itself is private-capable. The link is BEARER CASH: it is returned once in
 * this response and stored on the row for the borrower's own dashboard; it is never logged.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.SAGE_ADMIN_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("x-sage-admin-secret")?.trim();
  return !!header && header === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: {
    action?: string;
    wallet?: string;
    usd?: number;
    multiple?: number;
    waterfallBps?: number;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action === "history") {
    const rows = advanceHistory(body.wallet ?? "");
    // The borrower's claim secret is theirs; the pot's repayment secrets are the operator's own.
    return NextResponse.json({
      ok: true,
      advances: rows.map((a) => ({ ...a, disburseClaimSecret: a.disburseClaimSecret ? "(held)" : null, repayments: a.repayments.map((r) => ({ ...r, claimSecret: "(held)" })) })),
    });
  }

  if (body.action !== "disburse") {
    return NextResponse.json({ error: `unknown action: ${body.action ?? "(none)"}` }, { status: 400 });
  }
  // ONE disbursement function, shared with the self-serve door (lib/advance/disburse.ts), so the
  // operator and the borrower are bound by exactly the same rules.
  const r = await disburseAdvance({
    wallet: (body.wallet ?? "").trim(),
    usd: Number(body.usd),
    multiple: Number(body.multiple ?? 1),
    waterfallBps: Number(body.waterfallBps ?? 5000),
    dryRun: !!body.dryRun,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
