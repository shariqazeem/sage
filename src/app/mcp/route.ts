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

import { matchAgentKey, agentKeyBucket } from "@/lib/agent-api/auth";
import { rateLimit } from "@/lib/rate-limit";
import { MCP_TOOLS, MCP_SERVER_INFO, callSageTool } from "@/lib/mcp/server";

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

/** A stateless MCP server for one request: the tool list + the call dispatch. */
function buildServer(scheduleAfter: (fn: () => void | Promise<void>) => void): Server {
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await callSageTool(name, args, { scheduleAfter });
    if (result === null) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    return result as CallToolResult;
  });

  return server;
}

export async function POST(req: NextRequest): Promise<Response> {
  const { configured, authed } = matchAgentKey(req.headers);
  if (!configured) return rpcError(-32000, "Sage MCP is not configured.", 404);
  if (!authed) return rpcError(-32001, "Unauthorized: missing or invalid API key.", 401);
  if (!rateLimit("agent", agentKeyBucket()).ok) {
    return rpcError(-32000, "Rate limit exceeded.", 429);
  }

  const { req: nodeReq, res: nodeRes } = toReqRes(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(-32700, "Parse error.", 400);
  }

  const server = buildServer((fn) => after(fn));
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
