import { NextResponse, type NextRequest, after } from "next/server";

import { rateLimit, clientIp } from "@/lib/rate-limit";
import { callSageTool } from "@/lib/mcp/server";
import { publicCallerRef, publicMcpTools, sanitizePublicArgs } from "@/lib/mcp/public";
import { PAID_SERVICES } from "@/lib/mcp/pricing";
import { siteUrl } from "@/lib/site";
import { encodeHeader, metisSellerGate, readMetisPayment, type SellerGate } from "@/lib/x402/metis/seller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /mcp/metis/<tool> — one of Sage's paid tools, PAID IN USDC ON METIS over x402 (seller.ts).
 *
 * The same tool as `/mcp/public/<tool>` and the same result; this door charges its listed price in
 * m.USDC through Sage's own Metis facilitator and serves only once the payment has settled. GET (or a
 * POST without a payment) answers 402 with the requirements in the PAYMENT-REQUIRED header and the
 * body; a POST with the signed payment in PAYMENT-SIGNATURE answers 200 with the tool's JSON and the
 * settlement in PAYMENT-RESPONSE. The free door is untouched, so a marketplace that lists it free
 * still sees it free.
 */

const notFound = () => NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
const PAID = new Set(PAID_SERVICES.map((s) => s.tool));

function refusal(gate: Extract<SellerGate, { kind: "challenge" | "rejected" }>): Response {
  const rejected = gate.kind === "rejected" ? { rejected: gate.reason, message: gate.message, ...(gate.settlement ? { settlement: gate.settlement } : {}) } : {};
  return NextResponse.json(
    {
      error: "payment_required",
      message: gate.kind === "rejected" ? gate.message : `Sage's "${gate.service.serviceName}" costs $${gate.service.priceUsd} in USDC on Metis. Sign the accepts[0] entry as a Permit2 witness transfer and call again with it in the PAYMENT-SIGNATURE header.`,
      ...rejected,
      x402Version: gate.challenge.x402Version,
      accepts: gate.challenge.accepts,
      resource: gate.challenge.resource,
      howToPay: {
        once: "Approve Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) to spend your m.USDC, one transaction.",
        each: "Sign EIP-712 PermitWitnessTransferFrom with spender = accepts[0].extra.permit2Proxy and witness.to = accepts[0].payTo, then repeat this request with the payment payload, base64, in PAYMENT-SIGNATURE.",
        client: "A working client: node scripts/x402-metis-pay.mjs <tool> '<arguments as JSON>' in the Sage repository.",
        free: "Every Sage tool is also callable free, under per-caller caps, at https://sagepays.xyz/mcp/public",
      },
    },
    { status: 402, headers: { "payment-required": encodeHeader(gate.challenge) } },
  );
}

async function gateFor(req: NextRequest, tool: string): Promise<SellerGate | Response> {
  if (!PAID.has(tool)) return notFound();
  if (!rateLimit("publicMcp", `metis:${clientIp(req.headers)}`).ok) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  return metisSellerGate(tool, req.headers, `${siteUrl()}/mcp/metis/${tool}`);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ tool: string }> }): Promise<Response> {
  const { tool } = await ctx.params;
  const gate = await gateFor(req, tool);
  if (gate instanceof Response) return gate;
  if (gate.kind === "closed") return NextResponse.json({ ok: false, error: gate.message }, { status: gate.status });
  if (gate.kind === "paid") {
    // a GET carries no arguments: the payment is settled, and the tool's card is what there is to give
    const def = publicMcpTools().find((t) => t.name === tool);
    return NextResponse.json({ tool, description: def?.description ?? null, inputSchema: def?.inputSchema ?? null, paid: gate.settlement }, { headers: { "payment-response": encodeHeader(gate.settlement) } });
  }
  return refusal(gate);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ tool: string }> }): Promise<Response> {
  const { tool } = await ctx.params;
  let raw: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) raw = body as Record<string, unknown>;
  } catch {
    /* no body: answered with the challenge, or the card once paid */
  }
  const inner = raw.arguments && typeof raw.arguments === "object" && !Array.isArray(raw.arguments) ? (raw.arguments as Record<string, unknown>) : raw;
  // A paid call that cannot run must be refused BEFORE its payment settles, never after: check the
  // tool's required arguments first, and charge nothing for a call that would only return an error.
  if (readMetisPayment(req.headers)) {
    const def = publicMcpTools().find((t) => t.name === tool);
    const required = ((def?.inputSchema as { required?: string[] } | undefined)?.required ?? []).filter((k) => inner[k] === undefined || inner[k] === null || inner[k] === "");
    if (required.length > 0) return NextResponse.json({ ok: false, error: `Missing ${required.join(", ")}. Nothing was charged.` }, { status: 400 });
  }
  const gate = await gateFor(req, tool);
  if (gate instanceof Response) return gate;
  if (gate.kind === "closed") return NextResponse.json({ ok: false, error: gate.message }, { status: gate.status });
  if (gate.kind !== "paid") return refusal(gate);

  // Caller-supplied identity (founderOverride/clientRef) is stripped, exactly as on the free door.
  const args = sanitizePublicArgs(inner, publicCallerRef(req.headers, clientIp(req.headers)));
  const result = await callSageTool(tool, args, { scheduleAfter: (fn) => after(fn) });
  const headers = { "payment-response": encodeHeader(gate.settlement), "x-x402": "paid" };
  if (result === null) return NextResponse.json({ ok: false, error: "Not found.", paid: gate.settlement }, { status: 404, headers });
  const text = (result as { content?: Array<{ type: string; text?: string }> }).content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return NextResponse.json(JSON.parse(text), { headers });
    } catch {
      return NextResponse.json({ ok: true, result: text }, { headers });
    }
  }
  return NextResponse.json(result as unknown as Record<string, unknown>, { headers });
}
