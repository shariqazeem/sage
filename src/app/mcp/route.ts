import { NextResponse, type NextRequest, after } from "next/server";

import { matchAgentKey, agentKeyBucket } from "@/lib/agent-api/auth";
import { rateLimit } from "@/lib/rate-limit";
import { handleMcpMessage, type JsonRpcRequest, type JsonRpcResponse } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /mcp — Sage's Model Context Protocol endpoint (Streamable HTTP, JSON responses). A
 * ClawUp agent binds this as a custom tool; ClawUp injects the bound `SAGE_AGENT_API_KEY` on
 * each call. Fails CLOSED when the key is unset (404). `initialize` / `ping` / `tools/list`
 * work for the endpoint probe; `tools/call` requires the key. Every tool is read or
 * inspection-start only — nothing here can sign, settle, or move funds.
 */
function rpcError(code: number, message: string, status: number): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  const { configured, authed } = matchAgentKey(req.headers);
  if (!configured) return rpcError(-32000, "Sage MCP is not configured.", 404);

  // Rate-limit real (authed) traffic by the same per-key bucket as the REST surface.
  if (authed && !rateLimit("agent", agentKeyBucket()).ok) {
    return rpcError(-32000, "Rate limit exceeded.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(-32700, "Parse error.", 400);
  }

  const ctx = { authed, scheduleAfter: (fn: () => void | Promise<void>) => after(fn) };
  const batched = Array.isArray(body);
  const messages = (batched ? body : [body]) as JsonRpcRequest[];

  const responses: JsonRpcResponse[] = [];
  for (const m of messages) {
    const r = await handleMcpMessage(m, ctx);
    if (r) responses.push(r);
  }

  // All notifications → nothing to return.
  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batched ? responses : responses[0], { status: 200 });
}

export function GET(): Response {
  // No server-initiated SSE stream — MCP clients POST their messages.
  return rpcError(-32000, "Use POST for MCP messages.", 405);
}
