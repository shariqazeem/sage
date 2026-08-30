import { NextResponse } from "next/server";

import { readVaultBalance, readVaultState } from "@/lib/starknet/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC read of a Starknet vault: balance, status, owner.
 *
 * Read here rather than from the browser so one place holds the node URL, and so a founder's
 * console can tell them a read FAILED instead of spinning on "reading vault balance…" forever,
 * which is what the EVM-only card did for every Starknet campaign.
 *
 * Everything returned is already public on chain, so this needs no session — and giving it one
 * would only mean a founder locked out of their own balance by an expired cookie.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const address = new URL(req.url).searchParams.get("address")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "Not a Starknet address." }, { status: 400 });
  }
  try {
    const [state, balance] = await Promise.all([
      readVaultState(address),
      readVaultBalance(address),
    ]);
    return NextResponse.json({
      ok: true,
      owner: state.owner,
      operator: state.operator,
      status: state.status,
      statusLabel: state.statusLabel,
      balanceBase: balance.toString(),
      balanceUsd: (Number(balance) / 1e6).toFixed(2),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read that vault from Starknet." },
      { status: 502 },
    );
  }
}
