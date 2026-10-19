import { handleVerify } from "@/lib/x402/metis/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/x402/metis/verify: verify an x402 `exact` Permit2 payment on Metis Andromeda without
 * moving anything (x402-specification-v2.md §7.1). Off (404) unless X402_METIS_ENABLED="1"; see
 * src/lib/x402/metis/.
 */
export async function POST(req: Request): Promise<Response> {
  return handleVerify(req);
}
