import "server-only";
import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { accountMoves, type AccountAsset, type AccountMove, type AccountMoveKind } from "./schema";

/** Record a move Sage made from an account (a swap, a METIS send), with the transaction that made it. */
export function recordAccountMove(input: {
  founder: string;
  wallet: string;
  chainId: number;
  kind: AccountMoveKind;
  assetIn: AccountAsset;
  amountIn: bigint;
  assetOut?: AccountAsset | null;
  amountOut?: bigint | null;
  counterparty: string;
  txHash: string;
  approveTxHash?: string | null;
}): AccountMove {
  const row = {
    id: `mv_${randomBytes(9).toString("base64url")}`,
    founder: input.founder.toLowerCase(),
    wallet: input.wallet.toLowerCase(),
    chainId: input.chainId,
    kind: input.kind,
    assetIn: input.assetIn,
    amountIn: input.amountIn.toString(),
    assetOut: input.assetOut ?? null,
    amountOut: input.amountOut == null ? null : input.amountOut.toString(),
    counterparty: input.counterparty.toLowerCase(),
    txHash: input.txHash.toLowerCase(),
    approveTxHash: input.approveTxHash ? input.approveTxHash.toLowerCase() : null,
    createdAt: nowSeconds(),
  };
  db.insert(accountMoves).values(row).run();
  return row;
}

/** An account's moves, newest first. */
export function listAccountMoves(wallet: string, limit = 30): AccountMove[] {
  return db.select().from(accountMoves).where(eq(accountMoves.wallet, wallet.toLowerCase())).orderBy(desc(accountMoves.createdAt)).limit(limit).all();
}
