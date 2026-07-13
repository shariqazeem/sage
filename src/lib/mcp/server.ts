import "server-only";

import { runInspectionJob } from "@/lib/launch/job";
import {
  opStartInspection,
  opGetInspection,
  opGetCampaign,
  opGetSubmission,
  opGetProof,
  type OpResult,
} from "@/lib/agent-api/operations";

/**
 * Sage's Model Context Protocol server — the SAME five verified agent operations exposed over
 * MCP so a ClawUp agent can bind Sage as a custom tool. Transport-agnostic: it takes a parsed
 * JSON-RPC message + a context and returns a JSON-RPC response (or null for notifications), so
 * the protocol logic unit-tests without HTTP. It is READ + inspection-start ONLY — no tool can
 * sign, settle, move funds, or accept a key (the operations themselves enforce that).
 */

/** Default protocol version advertised when the client doesn't request one. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "sage", version: "1.0.0" } as const;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpContext {
  /** True once the presented API key matched. tools/list + tools/call require it. */
  authed: boolean;
  /** Schedule background work after the response — the transport wires this to `after()`. */
  scheduleAfter: (fn: () => void | Promise<void>) => void;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The five tools, with LLM-facing descriptions. Kept in lockstep with `operations.ts`. */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "sage_start_inspection",
    description:
      "Start a REAL Sage product-testing inspection for a founder. Sage inspects the live product and designs paid testing missions within the budget. It PREPARES a plan only — it never funds or pays; the founder approves and funds once in the Sage web app. Poll sage_get_inspection until stage='ready', then give the founder the approvalUrl.",
    inputSchema: {
      type: "object",
      properties: {
        productUrl: { type: "string", description: "Public HTTPS URL of the product to inspect." },
        goal: { type: "string", description: "What the founder wants testers to verify or learn." },
        targetUsers: { type: "string", description: "Who the testers should be." },
        budgetUsd: { type: "number", description: "Total testing budget in whole USDC." },
        repoUrl: { type: "string", description: "Optional public github.com repository URL." },
        clientRef: {
          type: "string",
          description:
            "A stable id for this founder/chat (e.g. the chat id) so repeat calls are idempotent.",
        },
      },
      required: ["productUrl", "goal", "targetUsers", "budgetUsd"],
    },
  },
  {
    name: "sage_get_inspection",
    description:
      "Poll a Sage inspection by id. Returns the honest stage, any needs-input questions or a failure, and — when ready — the mission plan plus the founder approvalUrl. Only the founder's own wallet can approve and fund; the agent cannot.",
    inputSchema: {
      type: "object",
      properties: {
        inspectionId: { type: "string", description: "The inspectionId from sage_start_inspection." },
      },
      required: ["inspectionId"],
    },
  },
  {
    name: "sage_get_campaign",
    description:
      "Get a Sage campaign's live status and recent tester activity: network + truthful token (testnet mUSDC vs mainnet USDC), funded/paid/remaining budget, mission slots, and each submission's Deputy decision (reviewing/verified/held/paid) with its payout tx and proof link. Read-only.",
    inputSchema: {
      type: "object",
      properties: { campaignId: { type: "string", description: "The campaign id." } },
      required: ["campaignId"],
    },
  },
  {
    name: "sage_get_submission",
    description:
      "Get one tester submission's status: reviewing/verified/held/paid, the Deputy's confidence and reason code, and a proof link once paid. Read-only.",
    inputSchema: {
      type: "object",
      properties: { submissionId: { type: "string", description: "The submission id." } },
      required: ["submissionId"],
    },
  },
  {
    name: "sage_get_proof",
    description:
      "Get the verifiable proof summary for a payout transaction hash: settled/verified (recomputed on-chain, never a stored flag), the outcome, network, recipient, and explorer + proof links. Read-only.",
    inputSchema: {
      type: "object",
      properties: { txHash: { type: "string", description: "The payout transaction hash." } },
      required: ["txHash"],
    },
  },
];

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Wrap an operation result as an MCP tool result (text content + isError). */
function toolResult<T>(r: OpResult<T>): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  const payload = r.ok ? r : { ok: false, error: r.error };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: !r.ok };
}

/** Dispatch a tool call to its operation. Returns null for an unknown tool name. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ReturnType<typeof toolResult> | null> {
  switch (name) {
    case "sage_start_inspection": {
      const r = opStartInspection(
        {
          productUrl: args.productUrl,
          goal: args.goal,
          targetUsers: args.targetUsers,
          budgetUsd: args.budgetUsd,
          repoUrl: args.repoUrl,
        },
        args.clientRef,
      );
      if (r.ok && r.created) {
        const jobId = r.inspectionId;
        ctx.scheduleAfter(() => runInspectionJob(jobId));
      }
      return toolResult(r);
    }
    case "sage_get_inspection":
      return toolResult(opGetInspection(asString(args.inspectionId)));
    case "sage_get_campaign":
      return toolResult(opGetCampaign(asString(args.campaignId)));
    case "sage_get_submission":
      return toolResult(opGetSubmission(asString(args.submissionId)));
    case "sage_get_proof":
      return toolResult(await opGetProof(asString(args.txHash)));
    default:
      return null;
  }
}

/**
 * Handle one JSON-RPC message. Returns a response object, or null for a notification (which
 * gets no reply). `initialize` and `ping` need no auth (so a probe can handshake); `tools/list`
 * and `tools/call` require `ctx.authed`.
 */
export async function handleMcpMessage(
  msg: JsonRpcRequest,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      const protocolVersion = typeof requested === "string" ? requested : MCP_PROTOCOL_VERSION;
      return ok({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
      });
    }
    case "ping":
      return ok({});
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return null; // notifications get no response
    case "tools/list":
      // Tool schemas aren't sensitive; leaving discovery open lets ClawUp's endpoint probe
      // succeed whether or not it presents the key. Actually invoking a tool still needs auth.
      return ok({ tools: MCP_TOOLS });
    case "tools/call": {
      if (!ctx.authed) return err(-32001, "Unauthorized: missing or invalid API key.");
      const name = asString(msg.params?.name);
      const args = (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const result = await callTool(name, args, ctx);
      if (result === null) return err(-32602, `Unknown tool: ${name || "(none)"}`);
      return ok(result);
    }
    default:
      if (isNotification) return null;
      return err(-32601, `Method not found: ${msg.method ?? "(none)"}`);
  }
}
