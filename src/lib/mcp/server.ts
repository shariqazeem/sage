import "server-only";

import { runInspectionJob } from "@/lib/launch/job";
import {
  opStartInspection,
  opGetInspection,
  opAnswerInspection,
  opGetCampaign,
  opGetSubmission,
  opGetProof,
  type OpResult,
} from "@/lib/agent-api/operations";

/**
 * Sage's MCP tool registry + dispatch — the SAME five verified agent operations, exposed so the
 * `/mcp` route can wire them into the official `@modelcontextprotocol/sdk` server. Transport-
 * agnostic (the SDK owns the JSON-RPC/Streamable-HTTP framing now); this module only defines the
 * tools and routes a call to its operation. READ + inspection-start ONLY — no tool can sign,
 * settle, move funds, or accept a key (the operations enforce that).
 */

export const MCP_SERVER_INFO = { name: "sage", version: "1.0.0" } as const;

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
    name: "sage_answer_questions",
    description:
      "When a Sage inspection came back needs_input, pass the founder's answer here. Sage folds the answer into the goal and RE-PLANS the missions with the missing intent. Returns right away; the founder is messaged again when the new plan is ready. Only call for an inspection that is currently needs_input (or failed).",
    inputSchema: {
      type: "object",
      properties: {
        inspectionId: { type: "string", description: "The inspectionId that needs input." },
        answer: { type: "string", description: "The founder's answer to Sage's question(s), verbatim." },
      },
      required: ["inspectionId", "answer"],
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

export interface McpContext {
  /** Schedule background work after the response — the route wires this to `after()`. */
  scheduleAfter: (fn: () => void | Promise<void>) => void;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Wrap an operation result as an MCP tool result (text content + isError). */
function toolResult<T>(r: OpResult<T>): ToolResult {
  const payload = r.ok ? r : { ok: false, error: r.error };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: !r.ok };
}

/**
 * Dispatch an MCP tool call to its operation. Returns null for an unknown tool name (the route
 * turns that into an SDK protocol error). `start_inspection` schedules the background run via
 * the context, so this stays free of request-context coupling.
 */
export async function callSageTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolResult | null> {
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
    case "sage_answer_questions": {
      const r = opAnswerInspection(asString(args.inspectionId), asString(args.answer));
      if (r.ok && r.replanned) {
        const jobId = asString(args.inspectionId);
        ctx.scheduleAfter(() => runInspectionJob(jobId));
      }
      return toolResult(r);
    }
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
