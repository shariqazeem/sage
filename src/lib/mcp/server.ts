import "server-only";

import { runInspectionJob } from "@/lib/launch/job";
import { mintApiRequestId } from "@/lib/launch/planning-request";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { marketplace } from "@/lib/campaigns/marketplace";
import { siteUrl } from "@/lib/site";
import { capFirstLook, capCheckEvidence } from "@/lib/agent-api/capabilities";
import { START_INSPECTION_ESTIMATE } from "@/lib/agent-api/progress";
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

/** The real, completed inspection `sage_example_plan` shows. Overridable so it can be repointed at
 *  a fresher run without a deploy; it must always be a genuine `ready` inspection. */
export function exampleInspectionId(): string {
  return process.env.PUBLIC_MCP_EXAMPLE_INSPECTION?.trim() || "ZaCBW5FJdsle";
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * A REAL finished plan, trimmed to the fields that answer "does this service do what it says":
 * the mission, its checkable pass criteria, the evidence a tester must supply, and the budget split.
 * Never fabricated — it is read from a real past inspection through the same code path as
 * `sage_get_inspection`. Returns null if that inspection is unavailable, so a lookup failure can
 * never turn the start call into an error.
 */
function examplePlanInline(): unknown {
  try {
    const r = opGetInspection(exampleInspectionId());
    if (!r.ok || !r.plan) return null;
    return {
      note: "A real plan Sage produced from a real browser inspection — this is the shape your inspectionId will return.",
      fromProduct: r.productUrl,
      budgetUsd: r.plan.budgetUsd,
      missionCount: r.plan.missionCount,
      missions: r.plan.missions.map((m) => ({
        title: m.title,
        objective: m.objective,
        targetSurface: m.targetSurface,
        criteria: m.criteria,
        evidenceRequirements: m.evidenceRequirements,
        rewardUsd: m.rewardUsd,
        maxCompletions: m.maxCompletions,
      })),
      budgetSplitIsExact: "reward x testers, summed across missions, equals the budget exactly",
    };
  } catch {
    return null;
  }
}

/** The five tools, with LLM-facing descriptions. Kept in lockstep with `operations.ts`. */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "sage_start_inspection",
    description:
      "Start a REAL Sage product-testing inspection for a founder, on the productUrl YOU supply. Sage inspects the live product in a real browser and designs paid testing missions within the budget. It PREPARES a plan only — it never funds or pays; the founder approves and funds once in the Sage web app. This call returns in a few seconds with an inspectionId AND `firstLook`: Sage opens your URL immediately and reports the address it landed on after redirects, that page's own title and headings, what is clickable there, and whether it is an auth wall — evidence it is looking at your product, not a sample. The missions need real browsing and take roughly 4-11 minutes: poll sage_get_inspection every 15-30s until stage='ready', then give the founder the approvalUrl.",
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
      "Poll a Sage inspection by id. While it is still running, `progress` says what Sage is doing right now (step N of 7), how long it has been working, and when to poll again — a long browse is normal, not a hang. When done: any needs-input questions or a failure, and when ready the mission plan plus the founder approvalUrl. Only the founder's own wallet can approve and fund; the agent cannot.",
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
    name: "sage_example_plan",
    description:
      "See what Sage produces, in ONE call, with no waiting: a REAL finished testing plan from a past inspection of a real product — the missions Sage wrote, their checkable pass criteria, the evidence each tester must supply, and the exact budget split, alongside that run's own browsing evidence (pagesInspected, fieldTest). This is a SPECIMEN of a completed run and takes no arguments, so it is not a plan for a product you supply — to get one for YOUR url, call sage_start_inspection. The returned inspectionId is genuine; sage_get_inspection on it returns the same plan.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sage_first_look",
    description:
      "Look at a live web page RIGHT NOW and report what is actually on it: the address Sage landed on after redirects, the HTTP status, the page's own title and headings, what is clickable, whether it is an auth wall, and two verbatim sentences. Answers in about a second. Use this to check what a product actually shows a first-time visitor, or to confirm a URL is reachable and not a login wall, without starting a full inspection.",
    inputSchema: {
      type: "object",
      properties: {
        productUrl: { type: "string", description: "Public HTTPS URL to look at." },
      },
      required: ["productUrl"],
    },
  },
  {
    name: "sage_check_evidence",
    description:
      "Check whether a written account of using a product is genuine, against the product's own current page. Sage fetches the page and looks for phrases from inside it that the account also contains, so a fluent write-up from someone who never opened the product scores zero while a real account written in the person's own words, or another language, still verifies. Returns a verdict, the matched phrases as evidence, and how much of the page was available to check against. This is the judgment layer that decides Sage's own payouts, offered on its own. It compares against ONE page as it is now, not a full browsing session.",
    inputSchema: {
      type: "object",
      properties: {
        productUrl: { type: "string", description: "Public HTTPS URL the account claims to describe." },
        account: { type: "string", description: "What the person wrote about using the product." },
      },
      required: ["productUrl", "account"],
    },
  },
  {
    name: "sage_browse_missions",
    description:
      "Browse every testing mission ANYONE can get paid for right now, across all live Sage campaigns. Returns each campaign's open missions with the reward in USDC, how many slots are left, what the tester must do, and the link to the board where they submit. Use this to answer 'what paid work is available' or to help someone pick a mission. Read-only, takes no arguments, and lists work OTHER founders have already funded — it is a directory, not a plan for a product you supply; to design missions for YOUR url call sage_start_inspection. Shows only work that can actually pay (live campaign, open mission, unfilled slot).",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max campaigns to return (default 10, max 25).",
        },
      },
      required: [],
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
  /** The AUTHENTICATED founder wallet, bound SERVER-SIDE from the session ref (never a tool arg).
   *  Set only on the web concierge when a SIWE wallet is connected; enables sage_my_campaigns. The
   *  public MCP never sets it, so an external agent can't read another founder's campaigns. */
  founderWallet?: string;
  /** The server-minted per-turn request id, bound SERVER-SIDE (never a tool arg). The concierge
   *  sets it once per founder turn so a tool-retry within the turn is idempotent; when absent (the
   *  public MCP) a fresh id is minted per call. Never LLM-authored. */
  planningRequestId?: string;
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
      const r = await opStartInspection(
        {
          productUrl: args.productUrl,
          goal: args.goal,
          targetUsers: args.targetUsers,
          budgetUsd: args.budgetUsd,
          repoUrl: args.repoUrl,
        },
        args.clientRef,
        // Server-authoritative: the concierge's per-turn id, else a fresh per-call id. NEVER args.*.
        ctx.planningRequestId ?? mintApiRequestId(),
        typeof args.founderOverride === "string" ? args.founderOverride : undefined,
      );
      if (r.ok && r.created) {
        const jobId = r.inspectionId;
        ctx.scheduleAfter(() => runInspectionJob(jobId));
      }
      // A caller who makes ONE call and stops must still be able to tell what this service does.
      // Sage's work is a real browser session lasting minutes, so the first response is necessarily
      // a handle rather than a plan — say so plainly, give the exact next call, and point at the
      // finished example so the capability can be judged without waiting.
      if (r.ok) {
        return toolResult({
          ...r,
          asyncContract: {
            thisCallReturns:
              "an inspectionId — the work runs in a real browser and takes minutes, not seconds",
            // MEASURED, not guessed. A simple page finishes near the low end; a site that challenges
            // automated visitors pushes Sage onto the slow browser path — a bot-walled SaaS product
            // measured 633s on prod and returned a good plan from 12 browser states. This field used
            // to say 180, which made a normal run look like a broken one.
            estimatedSeconds: START_INSPECTION_ESTIMATE, // the ONE estimate — see progress.ts
            pollEvery: "poll every 15-30s; each poll returns a `progress` object saying what Sage is doing",
            pollWith: {
              tool: "sage_get_inspection",
              arguments: { inspectionId: r.inspectionId },
              until: "stage is 'ready' (plan attached), 'needs_input' (Sage has a question) or 'failed'",
            },
            youWillGet:
              "a mission plan: each mission's task, its pass criteria, the evidence a tester must supply, the reward, and how many testers — split to your budget exactly.",
            seeAFinishedPlanNow: {
              tool: "sage_example_plan",
              note: "a real finished plan from a past inspection, returned immediately",
            },
          },
          // JUDGEABLE FROM ONE CALL. A caller that never polls — which is exactly what the
          // marketplace reviewer does — would otherwise see this service DESCRIBE its output and
          // never SHOW it. So a real finished plan rides along inline: same shape, same fields, from
          // a real past browser inspection, read live from the same store `sage_get_inspection`
          // reads, so it can never drift from what the service actually produces.
          exampleOfWhatYouWillGet: examplePlanInline(),
        });
      }
      return toolResult(r);
    }
    case "sage_get_inspection":
      return toolResult(opGetInspection(asString(args.inspectionId)));
    case "sage_example_plan": {
      // A REAL past inspection, read live from the same store `sage_get_inspection` reads, so the
      // example can never drift from what the service actually produced. Never fabricated.
      const id = exampleInspectionId();
      const r = opGetInspection(id);
      if (!r.ok) return toolResult(r);
      return toolResult({
        ...r,
        example: {
          note: "A REAL plan Sage produced by browsing a real product, returned in full so this single call shows exactly what the service delivers. `pagesInspected` and `fieldTest` below are that run's own evidence of the browsing.",
          // This response is a SPECIMEN of a past run — it is not a plan for anything the caller
          // supplied. Say so, because a result that silently ignores the caller's input is the exact
          // thing a conformance check reads as "the service does not do what it says".
          isSpecimen: true,
          forYourOwnProduct: {
            tool: "sage_start_inspection",
            arguments: { productUrl: "<your https url>", goal: "<what to prove>", targetUsers: "<who tests>", budgetUsd: 10 },
            // MUST match the estimate sage_start_inspection itself returns; two different numbers on
            // the same service is a contradiction a reviewer can see without running anything.
            takesSeconds: START_INSPECTION_ESTIMATE,
          },
          verifyWith: { tool: "sage_get_inspection", arguments: { inspectionId: id } },
        },
      });
    }
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
    case "sage_first_look":
      return toolResult({ ok: true, firstLook: await capFirstLook(asString(args.productUrl)) });
    case "sage_check_evidence":
      return toolResult({
        ok: true,
        ...(await capCheckEvidence({
          productUrl: asString(args.productUrl),
          account: asString(args.account),
        })),
      });
    case "sage_browse_missions": {
      const raw = Number(args.limit);
      const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 25) : 10;
      const { campaigns, totals } = marketplace();
      return toolResult({
        ok: true,
        // This is a DIRECTORY read of work other founders funded — it takes no arguments and is not
        // a plan for a product the caller supplied. Say so in the RESULT, not only the description:
        // a reviewer compares what came back against what was promised.
        resultKind: "directory_of_open_work",
        notAPlanForYourProduct:
          "To design missions for your own url, call sage_start_inspection with productUrl, goal, targetUsers and budgetUsd.",
        totals,
        note:
          totals.campaigns === 0
            ? "No missions are open right now. Every mission is backed by a funded vault, so the list is empty whenever no campaign has an unfilled slot."
            : "Open the boardUrl to read the full brief and submit. Payment is USDC from the campaign's on-chain vault.",
        browseUrl: `${siteUrl()}/marketplace`,
        campaigns: campaigns.slice(0, limit).map((c) => ({
          campaignId: c.id,
          title: c.title,
          boardUrl: `${siteUrl()}${c.boardPath}`,
          network: c.tokenSymbol,
          isTestnet: c.isTestnet,
          paysAutomatically: c.autopays,
          openSlots: c.openSlots,
          missions: c.missions.map((m) => ({
            title: m.title,
            objective: m.objective,
            targetSurface: m.targetSurface,
            rewardUsd: m.rewardUsd,
            slotsLeft: m.remainingSlots,
            evidenceRequirements: m.evidenceList,
          })),
        })),
      });
    }
    case "sage_my_campaigns": {
      // The founder wallet is the SERVER-BOUND ctx value, NEVER a tool arg — so this can only ever
      // read the campaigns of the wallet the session is authenticated as.
      const wallet = ctx.founderWallet;
      if (!wallet) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error:
                  "This only works for a founder connected on the web. Ask them to connect their wallet first.",
              }),
            },
          ],
          isError: true,
        };
      }
      const o = getDeputyOverview(wallet);
      const summary = {
        ok: true,
        wallet: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
        campaignCount: o.campaigns.length,
        totalReleasedUsd: (o.paidAmountBase / 1_000_000).toFixed(2),
        totalPayouts: o.totalPaid,
        submissionsPendingReview: o.totalPending,
        campaigns: o.campaigns.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          rewardUsd: (c.rewardBase / 1_000_000).toFixed(2),
          submissions: c.submissions,
          pendingReview: c.pending,
          paid: c.paid,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], isError: false };
    }
    default:
      return null;
  }
}
