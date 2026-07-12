import { NextResponse, type NextRequest, after } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import { validateEvidenceUrl, validateRewardUsd, validateText, validateOptionalText } from "@/lib/campaigns/validate";
import { createInspectionJob } from "@/lib/db/inspection";
import { runInspectionJob, jobToView } from "@/lib/launch/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launch — start a founder-launch inspection. Validates the input (SSRF at
 * the door, budget → base units), creates a DURABLE job (idempotent), and runs the real
 * pipeline AFTER the response so the founder can poll true progress. Never deploys or
 * funds. Founder identity is the SIWE session wallet, or an anonymous namespace pre-wallet.
 */

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "product";
}
function rand(): string {
  // short, url-safe, non-crypto id suffix (uniqueness comes from the idempotency index).
  return Math.abs(Array.from(Date.now().toString(36)).reduce((a, c) => (a * 33 + c.charCodeAt(0)) | 0, 7)).toString(36).slice(0, 6);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // SSRF at the door — a private/loopback/non-https product URL is rejected immediately.
  const url = validateEvidenceUrl(body.productUrl);
  if (!url.ok) return NextResponse.json({ ok: false, error: `Product URL: ${url.error}` }, { status: 400 });

  const repo = validateOptionalText(body.repoUrl, "Repository URL", 300);
  if (!repo.ok) return NextResponse.json({ ok: false, error: repo.error }, { status: 400 });
  if (repo.value && !/^https:\/\/github\.com\//i.test(repo.value)) {
    return NextResponse.json({ ok: false, error: "Repository must be a public github.com URL." }, { status: 400 });
  }

  const goal = validateText(body.goal, "Goal", { max: 1200 });
  if (!goal.ok) return NextResponse.json({ ok: false, error: goal.error }, { status: 400 });
  const targetUsers = validateText(body.targetUsers, "Target users", { max: 800 });
  if (!targetUsers.ok) return NextResponse.json({ ok: false, error: targetUsers.error }, { status: 400 });

  // budget in whole USDC → 6dp base units (capped, floored) via the shared validator.
  const budget = validateRewardUsd(body.budgetUsd);
  if (!budget.ok) return NextResponse.json({ ok: false, error: `Budget: ${budget.error}` }, { status: 400 });

  const session = await getSessionAddress();
  const founder = session ?? "anonymous";
  const host = (() => {
    try {
      return new URL(url.value).host;
    } catch {
      return "product";
    }
  })();

  const { job, created } = createInspectionJob({
    founderWallet: founder,
    publicCampaignId: `launch-${slug(host)}-${rand()}`,
    productUrl: url.value,
    repoUrl: repo.value || null,
    goal: goal.value,
    targetUsers: targetUsers.value,
    totalBudgetBase: BigInt(budget.value),
    tokenDecimals: 6,
  });

  // run the REAL pipeline after responding; the founder polls /api/launch/<id>.
  if (created) after(() => runInspectionJob(job.id));

  return NextResponse.json({ ok: true, job: jobToView(job), created }, { status: created ? 201 : 200 });
}
