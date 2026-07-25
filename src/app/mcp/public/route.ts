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

import { rateLimit, clientIp } from "@/lib/rate-limit";
import { callSageTool } from "@/lib/mcp/server";
import {
  PUBLIC_MCP_SERVER_INFO,
  publicMcpEnabled,
  publicMcpTools,
  publicCallerRef,
  publicCallGuard,
  sanitizePublicArgs,
  isPublicTool,
  looksLikeJsonRpc,
  acceptsMcp,
  MCP_ACCEPT,
} from "@/lib/mcp/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /mcp/public — Sage's KEYLESS Model Context Protocol endpoint: the Agent Service Provider
 * surface any external agent can bind (OKX.AI, ClawUp, Claude Code, Codex, a plain MCP client).
 * Free per call — it returns the result directly, no payment step.
 *
 * Same official SDK transport as the authenticated `/mcp`, and the SAME operations — the difference
 * is entirely the trust boundary in `lib/mcp/public.ts`: an allowlisted tool set, a SERVER-DERIVED
 * caller namespace (`founderOverride` and `clientRef` from the caller are stripped, so a public
 * agent can never bind a plan to a wallet it doesn't control), no money tools, and hard caps.
 *
 * What an external agent can do: ask Sage to inspect a live product and design paid testing
 * missions inside a budget, poll that plan, answer Sage's clarifying questions, read a campaign,
 * and verify a payout receipt against the chain. What it CANNOT do: approve, fund, settle, sign,
 * or read another founder's campaigns or a tester's submission. Funding is always the founder's
 * own wallet, on Sage's web app, behind their own signature.
 *
 * Off unless `PUBLIC_MCP_ENABLED=1` (a clone of this repo ships closed).
 */
function rpcError(code: number, message: string, status: number): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status },
  );
}

/** What this service is, in plain JSON — the answer to any caller that isn't speaking MCP. */
function serviceCard() {
  return {
    service: "Sage — autonomous paid user testing",
    summary:
      "Point Sage at a live product with a budget. It browses the product in a real browser, designs paid testing missions with verifiable pass criteria, and — once the founder funds it — pays human testers in USDC for verified evidence, inside on-chain limits it cannot exceed. Every payout publishes a receipt anchored to an on-chain transaction.",
    transport: "mcp/streamable-http",
    endpoint: "https://sagepays.xyz/mcp/public",
    pricing: {
      model: "free",
      note: "Free per call. Funding a campaign is the founder's own wallet.",
    },
    tools: publicMcpTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    usage: {
      protocol: "JSON-RPC 2.0 over HTTP POST (Model Context Protocol, Streamable HTTP)",
      example:
        'curl -X POST https://sagepays.xyz/mcp/public -H "content-type: application/json" -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\'',
    },
    boundaries: [
      "This surface cannot approve, fund, settle, or sign anything.",
      "Plans are prepared under an anonymous namespace; the founder claims and funds them with their own wallet at https://sagepays.xyz/launch/<inspectionId>.",
      "Payout receipts are recomputed from the chain, never a stored flag: https://sagepays.xyz/proof/<txHash>.",
    ],
    docs: "https://sagepays.xyz",
  };
}

/** A stateless MCP server for one public request: the published tool list + guarded dispatch. */
function buildPublicServer(
  ref: string,
  scheduleAfter: (fn: () => void | Promise<void>) => void,
): Server {
  const server = new Server(PUBLIC_MCP_SERVER_INFO, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: publicMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    // An unpublished tool is not "denied" — on this surface it does not exist.
    if (!isPublicTool(name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const guard = publicCallGuard(name, ref, (kind, key) => rateLimit(kind, key).ok);
    if (!guard.ok) {
      // A cap is a normal answer, not a protocol fault — the calling agent can read it and adapt.
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: false, error: guard.message }) },
        ],
        isError: true,
      } satisfies CallToolResult;
    }
    const args = sanitizePublicArgs(
      (req.params.arguments ?? {}) as Record<string, unknown>,
      ref,
    );
    // No founderWallet in the context: `sage_my_campaigns` is unreachable here by construction.
    const result = await callSageTool(name, args, { scheduleAfter });
    if (result === null) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    return result as CallToolResult;
  });

  return server;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!publicMcpEnabled()) {
    return rpcError(-32000, "Sage's public MCP endpoint is not enabled.", 404);
  }

  const ref = publicCallerRef(req.headers, clientIp(req.headers));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Not JSON at all — a probe, not a protocol error worth a 400 to a reviewer with curl.
    return NextResponse.json(serviceCard(), { status: 200 });
  }

  // A caller who isn't speaking MCP gets the service card with a 200, not a protocol fault it
  // cannot interpret. This is how a marketplace reviewer with `curl -i` sees the endpoint.
  if (!looksLikeJsonRpc(body)) {
    return NextResponse.json(serviceCard(), { status: 200 });
  }

  // A real MCP message under-specifying Accept is served anyway: the transport requires both
  // application/json and text/event-stream, and a plain `curl -X POST` offers neither.
  const request = acceptsMcp(req.headers.get("accept"))
    ? req
    : new Request(req.url, {
        method: "POST",
        headers: (() => {
          const h = new Headers(req.headers);
          h.set("accept", MCP_ACCEPT);
          return h;
        })(),
      });

  const { req: nodeReq, res: nodeRes } = toReqRes(request as NextRequest);

  const server = buildPublicServer(ref, (fn) => after(fn));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  nodeRes.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(nodeReq, nodeRes, body);
  return toFetchResponse(nodeRes);
}

/**
 * GET — MCP clients POST their messages, so there is no server-initiated stream here. A plain GET
 * (a human, a registry crawler, a reviewer) gets the service card instead of a bare error: what
 * this service does, what it costs, and the exact tool names.
 */
export function GET(req: NextRequest): Response {
  if (!publicMcpEnabled()) {
    return rpcError(-32000, "Sage's public MCP endpoint is not enabled.", 404);
  }
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return rpcError(-32000, "Use POST for MCP messages.", 405);
  }
  return NextResponse.json(serviceCard());
}
