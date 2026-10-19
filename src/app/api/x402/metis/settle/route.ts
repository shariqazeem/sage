import { handleSettle } from "@/lib/x402/metis/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/x402/metis/settle: settle an x402 `exact` Permit2 payment on Metis Andromeda, once
 * (x402-specification-v2.md §7.2). Moves the payer's m.USDC to the payee through the Permit2 proxy,
 * paying the gas in METIS. Off (404) unless X402_METIS_ENABLED="1"; see src/lib/x402/metis/.
 */
export async function POST(req: Request): Promise<Response> {
  return handleSettle(req);
}
