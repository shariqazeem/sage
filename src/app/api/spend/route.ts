import { NextResponse, type NextRequest } from "next/server";
import {
  getAddress,
  keccak256,
  parseUnits,
  toBytes,
  type Address,
  type Hash,
} from "viem";
import { getVaultState, vaultAddressForOperator } from "@/lib/deputy/chain";
import { submitRequestSpend } from "@/lib/deputy/signer";

// Real chain writes — never cached, Node runtime (the signer reads the fs).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scenario = "approved" | "rejected";

/**
 * Vendor address derived exactly as CreateVault.s.sol does:
 * `address(uint160(uint256(keccak256(bytes(name)))))` — i.e. the last 20 bytes
 * of the name's keccak hash. "Clearbit" is on the vault's approved list.
 */
function vendorFromName(name: string): Address {
  return getAddress(`0x${keccak256(toBytes(name)).slice(-40)}`);
}

// Both scenarios pay the SAME approved vendor ("Clearbit") — only the amount
// differs, which is the whole point: a small spend settles; an over-cap spend is
// blocked. The rejected amount is the vault's REAL per-tx cap + 1 (read live), so
// it always exceeds the cap regardless of any redeploy → SpendRejected, index 4.
const VENDOR_NAME = "Clearbit";
const APPROVED_USDC = 5;

async function amountForScenario(
  scenario: Scenario,
  vault: Address,
): Promise<{ amount: bigint; amountLabel: string }> {
  if (scenario === "approved") {
    return {
      amount: parseUnits(String(APPROVED_USDC), 6),
      amountLabel: `$${APPROVED_USDC.toFixed(2)}`,
    };
  }
  const { perTxCap } = await getVaultState(vault); // live, on-chain cap
  const over = perTxCap + 1; // one whole token over the cap — unmistakably above
  return { amount: parseUnits(String(over), 6), amountLabel: `$${over.toFixed(2)}` };
}

export async function POST(req: NextRequest) {
  let scenario: unknown;
  try {
    ({ scenario } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (scenario !== "approved" && scenario !== "rejected") {
    return NextResponse.json(
      { error: "scenario must be 'approved' or 'rejected'." },
      { status: 400 },
    );
  }

  const vault = vaultAddressForOperator("launch-growth");
  if (!vault) {
    return NextResponse.json(
      { error: "No vault configured (NEXT_PUBLIC_VAULT_ADDRESS)." },
      { status: 500 },
    );
  }

  // Unique per request so each spend is its own attributable intent.
  const intentHash = keccak256(
    toBytes(`deputy-gate:${scenario}:${Date.now()}`),
  ) as Hash;

  try {
    const { amount, amountLabel } = await amountForScenario(scenario, vault);
    const result = await submitRequestSpend({
      vault,
      vendor: vendorFromName(VENDOR_NAME),
      amount,
      intentHash,
    });
    return NextResponse.json({
      scenario,
      txHash: result.txHash,
      ok: result.settled,
      failedCheckIndex: result.failedCheckIndex,
      explorerUrl: result.explorerUrl,
      amount: amountLabel,
      vendor: VENDOR_NAME,
    });
  } catch (err) {
    console.error("[api/spend] chain write failed:", err);
    return NextResponse.json(
      { error: "On-chain write failed. See server logs." },
      { status: 502 },
    );
  }
}
