import { NextResponse, type NextRequest, after } from "next/server";

import { rateLimit, clientIp } from "@/lib/rate-limit";
import { callSageTool } from "@/lib/mcp/server";
import {
  publicMcpEnabled,
  publicMcpTools,
  publicCallerRef,
  publicCallGuard,
  sanitizePublicArgs,
  isPublicTool,
} from "@/lib/mcp/public";
import { priceOf } from "@/lib/mcp/pricing";
import { siteUrl } from "@/lib/site";
import {
  okxPaywall,
  challengeBody,
  challengeHeaders,
  paidHeaders,
} from "@/lib/x402/okx-paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /mcp/public/<toolName> — a REST-shaped call of the same tools `/mcp/public` serves over
 * JSON-RPC.
 *
 * This exists because a real client tried it and got a 404. From the prod access log, the OKX
 * marketplace reviewer's client:
 *
 *   31/Jul/2026:16:12:38  GET  /mcp/public                        405
 *   31/Jul/2026:16:12:39  POST /mcp/public                        200
 *   31/Jul/2026:16:12:40  POST /mcp/public                        200
 *   31/Jul/2026:16:13:26  POST /mcp/public/sage_start_inspection  404   <-- this
 *
 * A 404 on a tool the tool list just advertised reads as a broken service, and the listing was
 * pulled. Guessing this path is a reasonable thing for a client to do; refusing it bought us
 * nothing. So it is served — through the SAME guards as the JSON-RPC surface, imported rather than
 * re-implemented, because two copies of an authorization predicate is how one of them ends up
 * weaker than the other.
 *
 * The body is the tool's arguments, either bare (`{"productUrl": …}`) or wrapped
 * (`{"arguments": {…}}`). No JSON-RPC envelope, and the result is the plain tool JSON.
 */

function notFound(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Not found." },
    { status: 404 },
  );
}

/** The tool's own card: what it does, what it costs, and exactly what to POST here. */
function toolCard(name: string) {
  const def = publicMcpTools().find((t) => t.name === name);
  const priced = priceOf(name);
  return {
    tool: name,
    description: def?.description ?? null,
    inputSchema: def?.inputSchema ?? null,
    price: priced
      ? {
          service: priced.serviceName,
          amount: `$${priced.priceUsd}`,
          standard: "x402",
          note: "POST with arguments to receive the payment challenge, then call again with the signed authorization in the PAYMENT header.",
        }
      : {
          amount: "free",
          note: "Reading back work you already bought, and verifying what Sage published, are never charged.",
        },
    usage: {
      restStyle: `POST https://sagepays.xyz/mcp/public/${name} with the arguments as the JSON body`,
      mcpStyle:
        'POST https://sagepays.xyz/mcp/public with {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"' +
        name +
        '","arguments":{…}}}',
      note: "Both call the same tool and return the same result. The MCP endpoint is the canonical one.",
    },
  };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tool: string }> },
): Promise<Response> {
  if (!publicMcpEnabled()) return notFound();

  const { tool } = await ctx.params;
  // An unpublished tool does not exist on this surface — same rule as the JSON-RPC handler.
  if (!isPublicTool(tool)) return notFound();

  const ref = publicCallerRef(req.headers, clientIp(req.headers));

  const guard = publicCallGuard(tool, ref, (kind, key) => rateLimit(kind, key).ok);
  if (!guard.ok) {
    // A cap is a normal answer the caller can read and adapt to, not a protocol fault.
    return NextResponse.json({ ok: false, error: guard.message }, { status: 429 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // No body at all — treat it as a discovery probe and answer with the tool's card.
    return NextResponse.json(toolCard(tool), { status: 200 });
  }

  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  // Accept both the bare arguments and an `{arguments: {...}}` wrapper.
  const inner =
    raw.arguments && typeof raw.arguments === "object" && !Array.isArray(raw.arguments)
      ? (raw.arguments as Record<string, unknown>)
      : raw;

  // PAYMENT, before any work. Each service is its own priced resource, so the gate sits here rather
  // than in the tool: the tool must not know or care whether someone paid to reach it.
  //
  // The origin is the CANONICAL site, never `req.url`. Behind nginx that request carries the internal
  // origin, so the challenge quoted a resource at localhost:3000 — an address a buyer cannot reach and
  // a reviewer would fairly read as a broken service.
  const origin = siteUrl();
  const gate = await okxPaywall(tool, req.headers, origin);
  if (gate.kind === "challenge" || gate.kind === "rejected") {
    const problem = gate.kind === "rejected" ? gate.reason : undefined;
    return NextResponse.json(challengeBody(gate.service, gate.challenge, problem), {
      status: 402,
      headers: challengeHeaders(gate.challenge),
    });
  }

  // Strips caller-supplied identity (founderOverride/clientRef) exactly as the JSON-RPC path does.
  const args = sanitizePublicArgs(inner, ref);

  const result = await callSageTool(tool, args, { scheduleAfter: (fn) => after(fn) });
  if (result === null) return notFound();

  const okHeaders = gate.free ? undefined : paidHeaders(gate.payer);

  // Unwrap the MCP content envelope so a REST caller gets the tool's JSON directly.
  const text = (result as { content?: Array<{ type: string; text?: string }> }).content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return NextResponse.json(JSON.parse(text), { headers: okHeaders });
    } catch {
      return NextResponse.json({ ok: true, result: text }, { headers: okHeaders });
    }
  }
  return NextResponse.json(result as unknown as Record<string, unknown>, { headers: okHeaders });
}

/** GET — the tool's card, so a reviewer or crawler that pokes the path learns how to call it. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ tool: string }> },
): Promise<Response> {
  if (!publicMcpEnabled()) return notFound();
  const { tool } = await ctx.params;
  if (!isPublicTool(tool)) return notFound();
  return NextResponse.json(toolCard(tool));
}
