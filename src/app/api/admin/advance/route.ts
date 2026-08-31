import { NextResponse, type NextRequest } from "next/server";
import { advanceCapacityUsd, walletCreditSignals } from "@/lib/campaigns/credit";
import { advanceHistory, createAdvance, recordDisbursement } from "@/lib/db/advances";
import { escrowPayouts } from "@/lib/starknet/claims";
import { claimUrl, mintClaimSecrets } from "@/lib/starknet/claim-link";
import { starknetConfig } from "@/lib/starknet/config";
import { siteUrl } from "@/lib/site";

/** cent-exact USD → 6-decimal base units — the same one-liner the direct compiler uses. */
const usdToBase = (usd: number): bigint => BigInt(Math.round(usd * 100)) * BigInt(10_000);

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
  const wallet = (body.wallet ?? "").trim();
  const usd = Number(body.usd);
  const multiple = Number(body.multiple ?? 1);
  const waterfallBps = Number(body.waterfallBps ?? 5000);
  if (!wallet || !Number.isFinite(usd) || usd <= 0) {
    return NextResponse.json({ error: "wallet and a positive usd amount are required" }, { status: 400 });
  }

  // THE PUBLISHED FORMULA BINDS THE LENDER TOO. Capacity comes from the live record at this
  // moment, with the lender's multiple — an operator cannot advance past their own formula.
  const rec = walletCreditSignals(wallet);
  if (!rec) {
    return NextResponse.json({ error: "no verified work record for that wallet — capacity is $0.00" }, { status: 409 });
  }
  const capacity = advanceCapacityUsd(rec.signals, multiple);
  if (usd > capacity) {
    return NextResponse.json(
      { error: `$${usd.toFixed(2)} exceeds capacity $${capacity.toFixed(2)} (= ${multiple}× monthly verified inflow, 90d window)` },
      { status: 409 },
    );
  }

  if (body.dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, capacityUsd: capacity, wouldDisburseUsd: usd, waterfallBps });
  }

  const cfg = starknetConfig();
  if (!cfg) return NextResponse.json({ error: "Starknet settlement is not configured" }, { status: 503 });

  // One active advance per borrower — the schema throws, we answer in words.
  let advance;
  try {
    advance = createAdvance({
      borrowerWallet: wallet,
      principalBase: usdToBase(usd),
      multiple,
      waterfallBps,
      potAddress: cfg.accountAddress,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error && /UNIQUE/i.test(e.message) ? "that wallet already has an active advance — one at a time, by design" : String(e) },
      { status: 409 },
    );
  }

  try {
    const secrets = mintClaimSecrets();
    const escrow = await escrowPayouts(
      [{ claimCommitment: secrets.claimCommitment, refundCommitment: secrets.refundCommitment, amountBase: usdToBase(usd) }],
      Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
    );
    recordDisbursement(advance.id, { tx: escrow.transactionHash, claimCommitment: secrets.claimCommitment, claimSecret: secrets.claimSecret });
    return NextResponse.json({
      ok: true,
      advanceId: advance.id,
      capacityUsd: capacity,
      disburseTx: escrow.transactionHash,
      // BEARER CASH — shown once, here, to the operator who will hand it to the borrower.
      claimUrl: claimUrl(siteUrl(), secrets.claimSecret),
    });
  } catch (e) {
    // The row exists with no money behind it — say so plainly; the operator retries or voids.
    return NextResponse.json(
      { error: `advance ${advance.id} created but DISBURSEMENT FAILED (${e instanceof Error ? e.message : String(e)}) — nothing was escrowed; retry will be refused by the one-active guard, resolve the row first`, advanceId: advance.id },
      { status: 502 },
    );
  }
}
