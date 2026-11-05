import "server-only";

import { getCampaign, getSubmissionByPayoutTx, listCampaigns, listMissions, listPaidSubmissionsFor, listSubmissions } from "@/lib/db/campaigns";
import { sameFounder } from "@/lib/auth/founder";
import { isMainnetChain } from "@/lib/deputy/networks";
import { sageJobIdFrom, sageReceiptTxFrom, type SageRecordLookup } from "@/lib/verify/sage-record";

/** The same reading of "launched" as the check itself (verify/sage-record.ts). */
const LAUNCHED = new Set(["live", "paused", "completed"]);
const ZERO = /^0x0{40}$/i;
/** A submission still in play cites its record; a refused one has given it back. */
const LIVE = new Set(["pending", "approved", "settling", "paid"]);
const usd = (base: number | null | undefined) => (typeof base === "number" && base > 0 ? base / 1_000_000 : null);

/**
 * SAGE'S RECORDS, AS THE PROOF CHECK READS THEM (verify/sage-record.ts). Only what the check needs: a job
 * (who posted it, when, where, whether it was launched, and what it asks for), a payout (to whom, when, for
 * what), and whether another submission to this job already used the record.
 */
export function defaultSageLookup(): SageRecordLookup {
  return {
    job(id) {
      const c = getCampaign(id);
      if (!c) return null;
      const rows = listMissions(id);
      const missions = rows.map((m) => ({ title: m.title, criteria: Array.isArray(m.criteria) ? (m.criteria as unknown[]).filter((x): x is string => typeof x === "string") : [] }));
      // a mission plan's vault holds Σ reward × completions; an older single-reward job holds reward × recipients
      const planned = rows.reduce((a, m) => a + m.rewardAmount * m.maxCompletions, 0);
      return {
        id: c.id,
        title: c.title,
        posterWallet: c.posterWallet,
        status: c.status,
        chainId: c.chainId,
        createdAt: c.createdAt,
        vaultAddress: c.vaultAddress ?? null,
        sandbox: !!c.sandbox,
        kind: c.kind,
        fundedUsd: planned > 0 ? usd(planned) : c.maxRecipients > 0 ? usd(c.rewardAmount * c.maxRecipients) : null,
        missions,
      };
    },
    payout(tx) {
      const s = getSubmissionByPayoutTx(tx);
      if (!s) return null;
      const c = getCampaign(s.campaignId);
      if (!c) return null;
      return { tx, wallet: s.wallet, status: s.status, paidAt: s.decidedAt ?? s.createdAt, campaignId: c.id, campaignTitle: c.title, chainId: c.chainId, amountUsd: usd(c.rewardAmount) };
    },
    earlier(action, wallet, before) {
      if (action === "launched_job") {
        return listCampaigns().filter(
          (c) => sameFounder(c.posterWallet, wallet) && LAUNCHED.has(c.status) && !!c.vaultAddress && !ZERO.test(c.vaultAddress) && !c.sandbox && isMainnetChain(c.chainId) && c.createdAt < before,
        ).length;
      }
      return listPaidSubmissionsFor(wallet).filter((s) => isMainnetChain(s.chainId) && (s.decidedAt ?? s.createdAt) < before).length;
    },
    usedBy(bountyId, recordKey, exceptSubmissionId) {
      const key = recordKey.toLowerCase();
      return listSubmissions(bountyId).filter((s) => {
        if (s.id === exceptSubmissionId || !LIVE.has(s.status)) return false;
        const cited = sageJobIdFrom(s.evidenceUrl, s.note) ?? sageReceiptTxFrom(s.evidenceUrl, s.note);
        return cited?.toLowerCase() === key;
      }).length;
    },
  };
}
