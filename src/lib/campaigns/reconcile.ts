import "server-only";

import { getAddress, type Address } from "viem";
import { policyVaultAbi, publicClient } from "@/lib/deputy/chain";
import {
  getCampaignsByVault,
  getVaultCursor,
  listSubmissions,
  recordChainEvent,
  setVaultCursor,
} from "@/lib/db/campaigns";
import { short } from "@/lib/format";
import { reconcileRange } from "./reconcile-range";

/**
 * Trustless journal reconciliation. Owner-signed vendor adds are ON-CHAIN events,
 * so we journal them from the chain — never from the client. After a settle and
 * (cheaply) on campaign-detail load, we read a vault's VendorAddQueued /
 * VendorAdded logs since the last journaled block and fold the new ones in,
 * idempotently by (txHash, logIndex). This closes the Pass 9 gap: founder-owned
 * vaults now get the full journal chain, and no path trusts client input.
 */

export interface ReconcileResult {
  inserted: number;
  toBlock: number;
  capped: boolean;
}

/** The shape we consume from a decoded vendor event log (both event types fit). */
interface VendorLog {
  args: { vendor?: Address; readyAt?: bigint };
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}

/**
 * Fold a vault's new vendor events into the journal. Returns null when there is
 * nothing new. Journal entries are linked to the campaign whose submitter is the
 * recipient; vendor adds for non-campaign recipients are skipped.
 */
export async function reconcileVendorEvents(
  vaultAddress: string,
  chainId?: number,
): Promise<ReconcileResult | null> {
  const vault = getAddress(vaultAddress);
  const client = publicClient(chainId);
  const latest = Number(await client.getBlockNumber());
  const plan = reconcileRange(getVaultCursor(vault), latest);
  if (!plan) return null;

  // recipient wallet → campaign, across every campaign this vault funds.
  const walletToCampaign = new Map<string, string>();
  for (const c of getCampaignsByVault(vault)) {
    for (const s of listSubmissions(c.id)) {
      if (!walletToCampaign.has(s.wallet.toLowerCase())) {
        walletToCampaign.set(s.wallet.toLowerCase(), c.id);
      }
    }
  }

  const fromBlock = BigInt(plan.fromBlock);
  const toBlock = BigInt(plan.toBlock);
  const [queuedRaw, addedRaw] = await Promise.all([
    client.getContractEvents({
      address: vault,
      abi: policyVaultAbi,
      eventName: "VendorAddQueued",
      fromBlock,
      toBlock,
    }),
    client.getContractEvents({
      address: vault,
      abi: policyVaultAbi,
      eventName: "VendorAdded",
      fromBlock,
      toBlock,
    }),
  ]);
  const queued = queuedRaw as unknown as VendorLog[];
  const added = addedRaw as unknown as VendorLog[];

  // Order entries by real block time (not reconcile time) so the journal reads in
  // sequence. Fetch each unique block's timestamp once.
  const blockNums = new Set<bigint>();
  for (const l of [...queued, ...added]) {
    if (l.blockNumber != null) blockNums.add(l.blockNumber);
  }
  const blockTime = new Map<bigint, number>();
  await Promise.all(
    [...blockNums].map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: bn });
        blockTime.set(bn, Number(b.timestamp));
      } catch {
        /* leave unset — falls back below */
      }
    }),
  );

  let inserted = 0;
  const fold = (
    logs: VendorLog[],
    kind: "vendor_queued" | "vendor_allowlisted",
  ) => {
    for (const log of logs) {
      const vendor = (log.args as { vendor?: Address }).vendor;
      if (!vendor) continue;
      const campaignId = walletToCampaign.get(vendor.toLowerCase());
      if (!campaignId) continue; // not a campaign recipient — nothing to journal

      const readyAt =
        kind === "vendor_queued"
          ? Number((log.args as { readyAt?: bigint }).readyAt ?? 0)
          : 0;
      const at =
        (log.blockNumber != null ? blockTime.get(log.blockNumber) : undefined) ??
        readyAt ??
        0;

      const ok = recordChainEvent({
        campaignId,
        submissionId: null,
        kind,
        detail: short(vendor),
        txHash: (log.transactionHash ?? "").toLowerCase(),
        logIndex: log.logIndex ?? 0,
        vaultAddress: vault,
        amount: null,
        failedCheckIndex: null,
        createdAt: at,
      });
      if (ok) inserted += 1;
    }
  };
  fold(queued, "vendor_queued");
  fold(added, "vendor_allowlisted");

  setVaultCursor(vault, plan.toBlock);
  return { inserted, toBlock: plan.toBlock, capped: plan.capped };
}
