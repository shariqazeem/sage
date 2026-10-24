import { NextResponse, type NextRequest, after } from "next/server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { toReqRes, toFetchResponse } from "fetch-to-node";

import { matchAgentKey, agentKeyBucket, presentedAgentKey } from "@/lib/agent-api/auth";
import { rateLimit } from "@/lib/rate-limit";
import { MCP_TOOLS, MCP_SERVER_INFO, callSageTool, type ToolResult } from "@/lib/mcp/server";
import { KEY_PREFIX, scopesOf, verifyAgentKey } from "@/lib/agent-keys/keys";
import { callWorkspaceTool, workspaceTools } from "@/lib/mcp/workspace-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /mcp — Sage's Model Context Protocol endpoint, on the official
 * `@modelcontextprotocol/sdk` Streamable-HTTP transport (stateless). A ClawUp agent binds this
 * as a custom tool; ClawUp injects the bound `SAGE_AGENT_API_KEY` on each call. Fails CLOSED when
 * the key is unset (404) or missing/wrong (401). The SDK owns all JSON-RPC / SSE / content-type
 * framing and protocol-version negotiation; we only supply the tool registry + dispatch, both
 * read/inspection-start only. A fresh server + transport is created per request (no session store).
 */
function rpcError(code: number, message: string, status: number): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });
}

type Surface = {
  tools: typeof MCP_TOOLS;
  call: (name: string, args: Record<string, unknown>, scheduleAfter: (fn: () => void | Promise<void>) => void) => Promise<ToolResult | null>;
};

/** A stateless MCP server for one request: the tool list + the call dispatch, for one caller's surface. */
function buildServer(scheduleAfter: (fn: () => void | Promise<void>) => void, surface: Surface): Server {
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: surface.tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await surface.call(name, args, scheduleAfter);
    if (result === null) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    return result as CallToolResult;
  });

  return server;
}

/**
 * Who is calling. A WORKSPACE KEY (sage_sk_…, minted by a workspace owner for their own agent) acts as
 * that owner, with that key's scopes, and works whether or not the shared integration key is set. Any
 * other key is the shared integration key (ClawUp), unchanged.
 */
function surfaceFor(req: NextRequest): Surface | NextResponse {
  const presented = presentedAgentKey(req.headers);
  if (presented.startsWith(KEY_PREFIX)) {
    const key = verifyAgentKey(presented);
    if (!key) return rpcError(-32001, "Unauthorized: this Sage key is unknown or was revoked.", 401);
    if (!rateLimit("agent", `ws:${key.id}`).ok) return rpcError(-32000, "Rate limit exceeded.", 429);
    const scopes = scopesOf(key);
    return {
      tools: workspaceTools(scopes),
      call: (name, args, scheduleAfter) => callWorkspaceTool(name, args, { founder: key.founder, scopes, scheduleAfter }),
    };
  }
  const { configured, authed } = matchAgentKey(req.headers);
  if (!configured) return rpcError(-32000, "Sage MCP is not configured.", 404);
  if (!authed) return rpcError(-32001, "Unauthorized: missing or invalid API key.", 401);
  if (!rateLimit("agent", agentKeyBucket()).ok) {
    return rpcError(-32000, "Rate limit exceeded.", 429);
  }
  return { tools: MCP_TOOLS, call: (name, args, scheduleAfter) => callSageTool(name, args, { scheduleAfter }) };
}

export async function POST(req: NextRequest): Promise<Response> {
  const surface = surfaceFor(req);
  if (surface instanceof NextResponse) return surface;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(-32700, "Parse error.", 400);
  }
  // Rebuilt, never reused: reading the body above consumes the stream, and passing the SAME request
  // to `toReqRes` raises "ReadableStream is locked" as an unhandled rejection on every call.
  const { req: nodeReq, res: nodeRes } = toReqRes(
    new Request(req.url, {
      method: "POST",
      headers: new Headers(req.headers),
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

  const server = buildServer((fn) => after(fn), surface);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  nodeRes.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(nodeReq, nodeRes, body);
  return toFetchResponse(nodeRes);
}

export function GET(): Response {
  // No server-initiated stream — MCP clients POST their messages.
  return rpcError(-32000, "Use POST for MCP messages.", 405);
}
