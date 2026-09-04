import "../../app/app.css";
import "@/styles/tester-board.css";
import "@/styles/workspace.css";
import { redirect } from "next/navigation";
import { workspaceContext } from "@/lib/workspaces/context";
import { listMembers, listWorkspaceCampaigns } from "@/lib/db/workspaces";
import { listSubmissions } from "@/lib/db/campaigns";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { CapitalPanel, type CapitalView } from "@/components/workspace/capital-panel";
import { quoteFor } from "@/lib/money/rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Capital", description: "Verified payouts as a credit record: what your workspace has paid, who earned it, and what that record unlocks." };

/**
 * THE FC PACKAGE, FROM INSIDE. What this workspace has paid, receipt by receipt; each member's
 * verified record; the lender view, the outcomes and the public explorer that make the record
 * underwritable; the advance facility. Every number is a row in the ledger.
 */
export default async function CapitalPage() {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start?next=/workspace/capital");
  if (!ctx.owned) redirect("/workspace");
  const ws = ctx.owned;
  const campaigns = listWorkspaceCampaigns(ws).filter((c) => !c.sandbox);
  let paidBase = 0;
  let payouts = 0;
  let refused = 0;
  const wallets = new Set<string>();
  const byWallet = new Map<string, { paidBase: number; payouts: number; lastAt: number }>();
  for (const c of campaigns) {
    for (const s of listSubmissions(c.id)) {
      if (s.status === "paid" && s.payoutTx) {
        paidBase += c.rewardAmount;
        payouts += 1;
        const key = s.wallet.toLowerCase();
        wallets.add(key);
        const cur = byWallet.get(key) ?? { paidBase: 0, payouts: 0, lastAt: 0 };
        cur.paidBase += c.rewardAmount;
        cur.payouts += 1;
        cur.lastAt = Math.max(cur.lastAt, s.decidedAt ?? s.createdAt);
        byWallet.set(key, cur);
      } else if (s.status === "rejected") refused += 1;
    }
  }
  // people, not wallets: collapse wallets the consolidation watch has linked
  const seen = new Set<string>();
  let people = 0;
  for (const w of wallets) {
    if (seen.has(w)) continue;
    people += 1;
    for (const l of linkedWalletsOf(w)) seen.add(l.toLowerCase());
    seen.add(w);
  }
  const members = listMembers(ws.id);
  /*
    A REAL RATE, OR NONE.
    The local-currency mechanic is the FC track's centre and it was described in a sentence. Drawn,
    it needs one number — the rate a J$ grant would actually be stamped at right now — and that
    number has to be the live one the composer would use, from the same quote source. When the rate
    provider is unreachable the figure renders its mechanism without an amount rather than a stale
    or invented one: a made-up rate on the page that argues Sage never invents amounts is the one
    mistake this section cannot make.
  */
  const jmd = await quoteFor("JMD");
  const view: CapitalView = {
    workspace: { name: ws.name },
    totals: { paidUsd: paidBase / 1e6, payouts, people, refused, campaigns: campaigns.length },
    earners: [...byWallet.entries()]
      .sort((a, b) => b[1].paidBase - a[1].paidBase)
      .slice(0, 12)
      .map(([wallet, v]) => ({
        wallet,
        paidUsd: v.paidBase / 1e6,
        payouts: v.payouts,
        lastAt: v.lastAt,
        member: members.find((m) => (m.address ?? "").toLowerCase() === wallet)?.displayName ?? null,
      })),
    rate: jmd ? { code: jmd.currency, rate: jmd.rate, asOf: jmd.asOf, source: jmd.source } : null,
    advance: { armed: process.env.ADVANCE_SELF_SERVE === "1", maxUsd: Number(process.env.ADVANCE_MAX_USD ?? 5) || 5, multiple: Number(process.env.ADVANCE_MULTIPLE ?? 1) || 1, waterfallPct: (Number(process.env.ADVANCE_WATERFALL_BPS ?? 5000) || 5000) / 100 },
  };
  return <CapitalPanel view={view} />;
}
