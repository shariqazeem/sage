import "server-only";
import { settledLedger } from "@/lib/campaigns/settled-ledger";
import { listCampaignEvents, listSubmissions } from "@/lib/db/campaigns";
import { decodeDetail } from "@/lib/campaigns/journal";
import { chainConfig, isMainnetChain } from "@/lib/deputy/networks";
import { siteUrl } from "@/lib/site";
import { founderCampaigns } from "./founder-plan";

/**
 * EXPORTS: what a finance team or a programme's auditor asks for, built only from what Sage
 * recorded. Real money only (a testnet row is never in an export), newest first. Every payout row
 * carries its receipt, so a line in a spreadsheet can be checked against the chain in one click.
 */

/** RFC 4180: quote every field, double any quote inside it. Spreadsheets read this everywhere. */
function csv(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}

const iso = (sec: number) => new Date(sec * 1000).toISOString().replace(".000Z", "Z");

export function payoutsCsv(founder: string): string {
  const jobs = new Map(founderCampaigns(founder).filter((c) => !c.sandbox && isMainnetChain(c.chainId)).map((c) => [c.id, c]));
  const origin = siteUrl();
  const rows = settledLedger()
    .filter((r) => r.mainnet && !r.operator && jobs.has(r.campaignId))
    .map((r) => {
      const job = jobs.get(r.campaignId)!;
      return [iso(r.at), job.title, job.id, chainConfig(r.chainId).name, r.wallet, (r.amountBase / 1e6).toFixed(2), r.txHash, `${origin}/proof/${r.txHash}`];
    });
  return csv([["paid_at", "job", "job_id", "network", "recipient", "amount_usdc", "transaction", "receipt"], ...rows]);
}

/**
 * The fraud report: per job, the work Sage refused (with its reason) and every wallet the farm watch
 * linked to another submitter. The reasons are the judge's own words, as stored.
 */
export function fraudCsv(founder: string): string {
  const rows: (string | number | null)[][] = [];
  for (const job of founderCampaigns(founder)) {
    if (job.sandbox || !isMainnetChain(job.chainId)) continue;
    for (const s of listSubmissions(job.id)) {
      if (s.status !== "rejected") continue;
      rows.push([iso(s.decidedAt ?? s.createdAt), job.title, job.id, "refused", s.wallet, s.rejectReason ?? ""]);
    }
    for (const e of listCampaignEvents(job.id)) {
      if (e.kind !== "wallet_cluster") continue;
      rows.push([iso(e.createdAt), job.title, job.id, "linked wallets", null, decodeDetail(e.detail).text ?? ""]);
    }
  }
  rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  return csv([["at", "job", "job_id", "finding", "wallet", "reason"], ...rows]);
}
