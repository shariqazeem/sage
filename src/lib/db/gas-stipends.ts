import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { gasStipends, type GasStipendRow } from "./schema";

export function getGasStipend(wallet: string): GasStipendRow | null {
  return db.select().from(gasStipends).where(eq(gasStipends.wallet, wallet.toLowerCase())).get() ?? null;
}

export function recordGasStipend(input: { wallet: string; chainId: number; amountWei: bigint; txHash: string; budgetBase: bigint }): void {
  db.insert(gasStipends)
    .values({ wallet: input.wallet.toLowerCase(), chainId: input.chainId, amountWei: input.amountWei.toString(), txHash: input.txHash, budgetBase: input.budgetBase.toString(), createdAt: nowSeconds() })
    .run();
}
