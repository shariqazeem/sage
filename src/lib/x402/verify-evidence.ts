import "server-only";

import { fetchEvidence } from "@/lib/deputy/evidence";
import { isX402Live, VERIFICATION_FEE_USD } from "./facilitator";
import { payAndCall } from "./payer";
import { classifyX402Failure, type X402Reason, type X402Status } from "./x402-status";

/** The base URL for the server calling its own paywalled evidence endpoint. */
function internalBaseUrl(): string {
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return app || `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

export interface VerifiedEvidence {
  text: string;
  contentSha256: string | null;
  ok: boolean;
  failReason?: string;
  /** the real GOAT x402 tx that paid for this verification, or null. */
  x402PaymentTx: string | null;
  /** the truthful RAIL-1 status of this verification's payment. */
  x402Status: X402Status;
  /** a sanitized reason code when the live payment fell back, else null. */
  x402Reason: X402Reason | null;
}

/**
 * RAIL 1 entrypoint the pipeline uses. When live, the Deputy PAYS 0.1 USDC to its
 * own paywalled /api/verify/evidence via the x402 payer, and the returned
 * paymentTx is a real GOAT tx. When not live, it fetches evidence directly (no
 * payment, x402PaymentTx null). If a live payment fails it falls back to a direct
 * fetch — honestly unpaid, never a simulated tx — so verification stays robust.
 */
export async function verifyEvidence(url: string): Promise<VerifiedEvidence> {
  if (!isX402Live()) {
    const ev = await fetchEvidence(url);
    return {
      text: ev.text,
      contentSha256: ev.contentSha256,
      ok: ev.ok,
      failReason: ev.failReason,
      x402PaymentTx: null,
      x402Status: "not_configured",
      x402Reason: null,
    };
  }
  try {
    const { result, paymentTx } = await payAndCall<{
      text: string;
      contentSha256: string | null;
      ok: boolean;
      failReason?: string | null;
    }>({
      url: `${internalBaseUrl()}/api/verify/evidence`,
      body: { url },
      amountUsd: VERIFICATION_FEE_USD,
    });
    return {
      text: result.text,
      contentSha256: result.contentSha256,
      ok: result.ok,
      failReason: result.failReason ?? undefined,
      x402PaymentTx: paymentTx,
      x402Status: "paid",
      x402Reason: null,
    };
  } catch (err) {
    // Non-blocking by design — log a one-line reason, never the full viem stack.
    const msg =
      (err as { shortMessage?: string })?.shortMessage ??
      (err instanceof Error ? err.message.split("\n")[0] : String(err));
    console.warn("[x402] paid verification unavailable — using a direct (unpaid) fetch:", msg);
    const ev = await fetchEvidence(url);
    return {
      text: ev.text,
      contentSha256: ev.contentSha256,
      ok: ev.ok,
      failReason: ev.failReason,
      x402PaymentTx: null,
      x402Status: "live_fallback",
      x402Reason: classifyX402Failure(msg),
    };
  }
}
