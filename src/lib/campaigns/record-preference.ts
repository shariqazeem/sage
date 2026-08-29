import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { recordPreferences } from "@/lib/db/schema";
import { nowSeconds } from "@/lib/db/keys";

/**
 * WHETHER A WORKER'S RECORD SHOWS WHAT THEY EARNED — their choice, and public until they make it.
 *
 * The default is not a technicality. Public receipts are what the record is FOR when the money is
 * grant or MSME capital: a programme distributing funds has to be able to show where they went,
 * and a ledger that hides amounts by default is useless to the institutions this product is trying
 * to serve. Auditability is the headline.
 *
 * Privacy is the other half of the same honesty. A contractor paid through Sage should not have to
 * carry a permanent public income graph as the price of getting paid — so they can turn amounts
 * off, and prove what they need to prove with a scoped attestation instead.
 *
 * Both are true at once and neither is the default for the other's users. Absent a choice, the
 * record is public.
 */

export function isRecordPrivate(walletRaw: string): boolean {
  const wallet = walletRaw.trim().toLowerCase();
  if (!wallet) return false;
  const row = db
    .select()
    .from(recordPreferences)
    .where(eq(recordPreferences.wallet, wallet))
    .get();
  return row?.amountsPrivate === true;
}

export function setRecordPrivate(walletRaw: string, amountsPrivate: boolean): void {
  const wallet = walletRaw.trim().toLowerCase();
  if (!wallet) throw new Error("a wallet is required");
  db.insert(recordPreferences)
    .values({ wallet, amountsPrivate, updatedAt: nowSeconds() })
    .onConflictDoUpdate({
      target: recordPreferences.wallet,
      set: { amountsPrivate, updatedAt: nowSeconds() },
    })
    .run();
}
