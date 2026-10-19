import { handleSupported } from "@/lib/x402/metis/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/x402/metis/supported: the x402 facilitator's capability list for Metis Andromeda
 * (x402-specification-v2.md §7.3). Off (404) unless X402_METIS_ENABLED="1"; see src/lib/x402/metis/.
 */
export async function GET(req: Request): Promise<Response> {
  return handleSupported(req);
}
