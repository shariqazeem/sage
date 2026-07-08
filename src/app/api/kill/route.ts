import { NextResponse } from "next/server";
import { killVaultAddress, vaultAddressForOperator } from "@/lib/deputy/chain";
import { submitRevoke } from "@/lib/deputy/signer";

// Real, terminal revoke() — never cached, Node runtime (signer reads the fs).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revoke the DISPOSABLE kill-demo vault (G4). The kill switch points here so the
 * primary vault is never touched. Returns the real tx + the status read back.
 */
export async function POST() {
  const killVault = killVaultAddress();
  if (!killVault) {
    return NextResponse.json(
      { error: "No kill vault configured (NEXT_PUBLIC_KILL_VAULT_ADDRESS)." },
      { status: 500 },
    );
  }

  // HARD SAFETY: refuse to revoke the primary vault under any circumstance.
  const primary = vaultAddressForOperator("launch-growth");
  if (primary && primary.toLowerCase() === killVault.toLowerCase()) {
    return NextResponse.json(
      { error: "Refusing to revoke: kill vault must differ from the primary vault." },
      { status: 500 },
    );
  }

  try {
    const result = await submitRevoke(killVault);
    return NextResponse.json({
      vault: killVault,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      newStatus: result.newStatus,
      revokedEvent: result.revokedEvent,
    });
  } catch (err) {
    console.error("[api/kill] revoke failed:", err);
    return NextResponse.json(
      { error: "On-chain revoke failed. See server logs." },
      { status: 502 },
    );
  }
}
