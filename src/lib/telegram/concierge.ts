import "server-only";

import { MCP_TOOLS, callSageTool, type McpContext } from "@/lib/mcp/server";
import { opGetInspection, type InspectionView } from "@/lib/agent-api/operations";
import { sendTelegram } from "@/lib/telegram/bot";
import { privyConfigured } from "@/lib/privy/client";
import { loadChatMessages, saveChatMessages } from "@/lib/db/concierge-chats";
import {
  AGENT_WALLET_TOOLS,
  isAgentWalletTool,
  callAgentWalletTool,
} from "@/lib/telegram/agent-wallet-tools";

/**
 * Sage's conversational front door on Telegram — its OWN agent, no third-party runtime.
 *
 * A free-form message from @sagedeputybot's webhook is run through CommonStack (the same
 * OpenAI-compatible brain the Deputy uses) with Sage's five read/inspection-start tools bound
 * IN-PROCESS (no MCP round-trip — this is our own app). The agent can inspect a product, start a
 * real investigation, and report campaign + payout status — the same read/inspect surface the web
 * app exposes. It CANNOT sign, fund, approve, or move money: those tools do not exist here, and
 * every economic authorization stays in the web app behind the founder's own wallet.
 *
 * Conversation memory is per-chat and in-process (a persistent pm2 process keeps it across
 * requests; a restart clears it — acceptable, chats are short). It never throws: a brain or tool
 * failure becomes an honest reply, never a broken webhook.
 */

// CommonStack (OpenAI-compatible). Read the SAME env as the frozen Deputy brain, directly, so this
// module never imports — or risks changing — the frozen verification layer (brain.ts).
const base = (): string =>
  (process.env.LLM_BASE_URL || process.env.COMMONSTACK_BASE_URL || "https://api.commonstack.ai/v1").replace(/\/+$/, "");
const key = (): string => process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim() || "";
const model = (): string =>
  process.env.CONCIERGE_MODEL?.trim() ||
  process.env.LLM_MODEL?.trim() ||
  process.env.DEPUTY_MODEL?.trim() ||
  "deepseek/deepseek-v4-flash";

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY = 12;
const TIMEOUT_MS = 30_000;

const BASE_PROMPT = `You are Sage, an autonomous product-testing agent, talking to a founder through your Telegram bot. Keep replies short and plain — this is a chat, not a document.

WHAT SAGE DOES: it turns a founder's product + budget into paid, verified testing missions. It inspects the real product, designs specific missions, funds an on-chain vault, then autonomously evaluates tester evidence and pays valid work within hard on-chain limits it can never exceed, publishing a verifiable proof for every payout.

NEVER INVENT A PRODUCT: only ever call sage_start_inspection for a URL the founder EXPLICITLY gave you in this chat. Never guess, default to, or make up a product URL (google.com, example.com, anything). If the founder says "launch", "go", or "funded" but you don't have a specific ready inspection in THIS conversation to act on, DO NOT start a new inspection — check sage_agent_wallet_status, and if you've lost track of which campaign they mean, simply ask them for the product or the campaign. Losing the thread is fine; inventing a product is never fine.

FIRST CONTACT: if the conversation is just starting and the founder hasn't given you a product URL yet — they said "hi", tapped /start, or asked what you do — don't call any tool. Reply with ONE short line on what you do (you design paid testing missions for their product and pay real testers in USDC autonomously, with a public proof for every payout), then ask for their product URL and a budget in a SINGLE question. The moment they give a URL, proceed normally.`;

const READ_TOOLS = `YOUR READ / INSPECT TOOLS (they run inside Sage; no keys pass through you):
- sage_start_inspection {productUrl, goal, targetUsers, budgetUsd, repoUrl?}: start a REAL inspection. It prepares a plan only. It returns right away; the plan builds in the background AND the founder is AUTOMATICALLY messaged the moment it's ready (or if it needs input / fails). So tell them you'll message them when it's done — do NOT tell them to poll, and don't call sage_get_inspection yourself unless they explicitly ask for a status before that message arrives.
- sage_get_inspection {inspectionId}: check an inspection's status on demand. If stage is not ready yet, tell the founder it's still working. If it needs input, ask them those questions.
- sage_get_campaign {campaignId}: report live status — network + token, funded/paid/remaining, missions, and each submission's Deputy decision + proof link.
- sage_get_submission {submissionId}: report one submission's state, confidence, and proof.
- sage_get_proof {txHash}: report one payout's verifiable proof.`;

// When Privy agent wallets are configured, the agent can fund + launch itself, within a hard cap.
const FUND_BLOCK = `YOU FUND + LAUNCH REAL-MONEY CAMPAIGNS FROM THIS CHAT — no browser, no MetaMask, no wallet app. A founder who wants you to run it just picks a per-campaign spending cap; you create their agent wallet right here (a policy-guarded wallet on GOAT), they send USDC to it, and you fund + launch their campaigns from it within a cap you can never exceed. Leftover stays as their balance for next time.

CRITICAL — WHEN A FOUNDER ASKS YOU TO FUND OR LAUNCH, YOU DO IT; NEVER DEFER IT BACK TO THEM. First call sage_agent_wallet_status. If their agent wallet is set up and funded, you MUST call sage_fund_and_launch — that is your core job. Do NOT reply "I cannot do this for you". Do NOT tell them to "personally approve and fund it with your own wallet". Do NOT hand them a web link to fund it. Yes it is real money — and the founder already funded their agent wallet and set the cap precisely so that YOU spend it for them; the wallet's on-chain policy makes overspending impossible, so there is nothing for them to personally approve. Deferring real-money funding back to the founder is a FAILURE, not caution. (The web approvalUrl exists only if a founder explicitly says they'd rather fund it themselves in a browser — never volunteer it.)

NEVER DO YOUR OWN MONEY MATH. To launch, call sage_fund_and_launch DIRECTLY — do not compare the budget to the cap yourself or decide it is "too big". sage_fund_and_launch checks the cap, balance, and gas itself and returns exactly what to relay: it deployed, or overCap / needsFunding / needsGas. This chat is ALWAYS GOAT mainnet with REAL USDC — never call an amount "mUSDC", "test", or "testnet". Tool fields ending in "Usd" are already whole dollars; a "...Base" field is 6-decimal base units (2000000 = 2 USDC, 900000 = 0.90 USDC) — NEVER quote a base-unit number to the founder.

YOUR AGENT-WALLET TOOLS:
- sage_agent_wallet_status {}: check if this founder has an agent wallet yet — its address, USDC balance, and their per-campaign cap. Check this before offering to fund.
- sage_setup_wallet {perCampaignCapUsd}: create the founder's agent wallet with the per-campaign cap they choose. ASK them for the cap (whole USDC) first, then call this. Returns the wallet address — give it to them and tell them to send USDC plus a little native BTC for gas (BTC is GOAT's native gas token) to it.
- sage_fund_and_launch {inspectionId}: fund + launch a READY inspection from the founder's agent wallet, within their cap. Use only after the inspection is ready AND status shows the wallet is funded. It creates + funds the vault and goes live on autopilot; report the campaignUrl it returns.
- sage_request_withdrawal {amountUsd, toAddress}: prepare a withdrawal of the founder's balance to an address they give. Moves NO funds — it validates and asks you to confirm the exact amount + address.
- sage_confirm_withdrawal {}: actually send the prepared withdrawal — ONLY after the founder clearly confirms the amount + address you read back to them. This moves real money.

FLOW WHEN A FOUNDER WANTS YOU TO RUN IT: inspect until ready → sage_agent_wallet_status → if not set up, ask their per-campaign cap and call sage_setup_wallet → give them the wallet address and tell them to send USDC (+ a little native BTC for gas; BTC is GOAT's gas token) → the moment the wallet shows funded, IMMEDIATELY call sage_fund_and_launch yourself (never ask the founder to fund or approve it, never hand them a link) → report the live campaign. After a successful launch, tell the founder: "I'll message you every time I pay a tester."

TO WITHDRAW (get their balance back out): sage_request_withdrawal with the amount + address → read the amount + address BACK to the founder and wait for a clear yes → sage_confirm_withdrawal. Never call sage_confirm_withdrawal without an explicit confirmation from the founder.

LIMITS YOU CANNOT BREAK: you only ever move the founder's OWN funds — into their OWN campaigns, or (only on their explicit request) to a withdrawal address they gave — up to the cap they set. Leftover stays as their balance until they withdraw it. The wallet's on-chain policy enforces this — not you — so you cannot be tricked into exceeding it.`;

// When agent wallets are NOT configured, the agent only prepares + reports; the founder funds in-browser.
const HANDOFF_BLOCK = `YOUR JOB IN CHAT: prepare and report. You do NOT hold keys, sign, approve, fund, or move money — those tools do not exist for you. When an inspection is ready, give the founder the approvalUrl (https://sagepays.xyz/launch/<id>); only their own wallet can approve + fund. After that Sage runs the campaign on its own and you report what it did.`;

const TAIL = `MONEY TRUTH: report the token EXACTLY as the tool returns it — "USDC" on GOAT mainnet is real money; "test mUSDC" on Metis Sepolia is testnet and has no value. Never merge them, never write "$" for a testnet payout, never invent an amount. Never claim a campaign is funded or a payout happened unless a tool result actually says so.

STYLE: plain text only — no markdown symbols, no bold. Paste URLs raw; Telegram links them. Be concrete and honest. If a tool returns an error, say so plainly and do not retry it in a loop. If the founder asks about something you need an id for and don't have, ask for it.`;

/** Build the system prompt for a chat — the money paragraph depends on whether agent wallets are on. */
function systemPrompt(chatId: string): string {
  const blocks = privyConfigured()
    ? [BASE_PROMPT, READ_TOOLS, FUND_BLOCK, TAIL]
    : [BASE_PROMPT, HANDOFF_BLOCK, READ_TOOLS, TAIL];
  return `${blocks.join("\n\n")}\n\nThis chat's id (use as clientRef): ${chatId}`;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatResponse {
  choices?: Array<{ message?: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } }>;
}

// Sage's tools as OpenAI-style function definitions. The read/inspect tools come from the public
// MCP registry; the agent-wallet tools (fund + launch) are concierge-only and appear only when Privy
// is configured — they must never be exposed to external MCP agents.
const TOOLS = [...MCP_TOOLS, ...(privyConfigured() ? AGENT_WALLET_TOOLS : [])].map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

/** Per-chat memory, persisted to the DB so a founder's thread survives a server restart (the system
 *  message is prepended fresh each turn, never stored). */
function loadHistory(chatId: string): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(loadChatMessages(chatId));
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}
function saveHistory(chatId: string, msgs: ChatMessage[]): void {
  saveChatMessages(chatId, JSON.stringify(msgs.slice(-MAX_HISTORY)));
}

const usdFrom = (base: string): string => `$${(Number(base) / 1_000_000).toFixed(2)}`;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Append an assistant line to a chat's memory, so the model knows what it already told the founder
 *  (e.g. the "your plan is ready" it sent proactively) on the founder's next turn. */
function pushAssistant(chatId: string, content: string): void {
  const next: ChatMessage[] = [...loadHistory(chatId), { role: "assistant", content }];
  saveHistory(chatId, next);
}

/** The plain-text follow-up for a finished inspection — ready plan, needs-input, or failure. */
function buildInspectionNotice(v: InspectionView): string {
  const host = safeHost(v.productUrl);
  if (v.ready && v.plan) {
    const total = v.plan.totalBudgetBase ? `, ${usdFrom(v.plan.totalBudgetBase)} total` : "";
    const rows = v.plan.missions
      .slice(0, 6)
      .map((m) => `• ${m.title} — ${usdFrom(m.rewardBase)} × ${m.maxCompletions}`)
      .join("\n");
    const fieldLine =
      v.fieldTest && v.fieldTest.screenshots > 0
        ? `\n\nI clicked through ${v.fieldTest.pages} page${v.fieldTest.pages === 1 ? "" : "s"} and took screenshots — see the plan link.`
        : "";
    return `Your testing plan for ${host} is ready — ${v.plan.missionCount} missions${total}:\n${rows}\n\nReply "launch" and I'll fund + launch it from your agent wallet.${fieldLine}`;
  }
  if (v.stage === "needs_input") {
    const qs = (v.needsInput ?? [])
      .slice(0, 4)
      .map((q) => `• ${q}`)
      .join("\n");
    return `I need a little more to finish your plan for ${host}:\n${qs || "• a few more details about your goal or testers"}\n\nJust reply here and I'll keep going.`;
  }
  return `I couldn't finish inspecting ${host}${v.failure ? `: ${v.failure}` : "."}\n\nWant to try a different URL or tweak the goal?`;
}

/**
 * Follow through on an inspection the founder just asked for: poll it to completion and DM them the
 * result. This keeps the agent's "I'll let you know" promise. It fires whether the call created a
 * fresh inspection OR hit the idempotency cache (`created: false`) for one the founder re-requested —
 * in the latter case the inspection is often ALREADY ready, so the first poll DMs the plan at once.
 * It's scheduled as a deferred job after the inspection's own run job, so a still-running one is
 * caught by the loop (a ~3-minute safety net).
 */
function maybeNotifyOnInspection(
  chatId: string,
  toolText: string,
  scheduleAfter: (fn: () => void | Promise<void>) => void,
): void {
  let inspectionId = "";
  try {
    const p = JSON.parse(toolText) as { ok?: boolean; inspectionId?: string };
    if (!p.ok || typeof p.inspectionId !== "string") return;
    inspectionId = p.inspectionId;
  } catch {
    return;
  }

  scheduleAfter(async () => {
    for (let i = 0; i < 45; i++) {
      const r = opGetInspection(inspectionId);
      if (!r.ok) return;
      if (r.ready || r.stage === "needs_input" || r.stage === "failed") {
        const notice = buildInspectionNotice(r);
        console.log("[concierge] inspection %s reached %s -> notifying chat %s (len=%d)", inspectionId, r.stage, chatId, notice.length);
        pushAssistant(chatId, notice);
        await sendTelegram(chatId, notice, { html: false });
        return;
      }
      await delay(4000);
    }
  });
}

async function chatCompletion(messages: ChatMessage[]): Promise<ChatResponse> {
  const res = await fetch(`${base()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model(),
      temperature: 0.3,
      max_tokens: 900,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`llm ${res.status}`);
  return (await res.json()) as ChatResponse;
}

/** Whether the conversational agent is switched on (an LLM key is configured). */
export function conciergeEnabled(): boolean {
  return !!key();
}

/**
 * Run one concierge turn for a chat: feed the message + short history to CommonStack with Sage's
 * tools bound, execute any tool calls IN-PROCESS, and return the final plain-text reply. Background
 * work (an inspection run) is deferred through `scheduleAfter` so the webhook can answer fast. Never
 * throws — any failure becomes an honest reply.
 */
export async function runConcierge(
  chatId: string,
  userText: string,
  scheduleAfter: (fn: () => void | Promise<void>) => void,
): Promise<string> {
  if (!key()) {
    return "My chat brain isn't switched on yet (no model key configured). You can still use /agent and /status.";
  }

  const history = loadHistory(chatId);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(chatId) },
    ...history,
    { role: "user", content: userText },
  ];
  const ctx: McpContext = { scheduleAfter };

  let reply = "";
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await chatCompletion(messages);
      const msg = data.choices?.[0]?.message;
      if (!msg) {
        reply = "I couldn't reach my brain just now — try again in a moment.";
        break;
      }
      messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            /* malformed args → let the tool report the miss */
          }
          // Bind every inspection to THIS chat server-side — never trust the model to pass clientRef
          // (a null clientRef collapsed idempotency to a shared namespace and left no chat linkage).
          if (tc.function.name === "sage_start_inspection") args.clientRef = chatId;

          const result = isAgentWalletTool(tc.function.name)
            ? await callAgentWalletTool(tc.function.name, args, chatId)
            : await callSageTool(tc.function.name, args, ctx);
          const text = result
            ? (result.content[0]?.text ?? "")
            : JSON.stringify({ ok: false, error: `unknown tool: ${tc.function.name}` });
          console.log("[concierge] tool=%s ok=%s -> %s", tc.function.name, !result?.isError, text.slice(0, 140));

          // Keep the "I'll let you know" promise: when a fresh inspection starts, follow it to
          // completion in the background and DM the founder the plan (or questions/failure).
          if (tc.function.name === "sage_start_inspection" && result && !result.isError) {
            maybeNotifyOnInspection(chatId, text, scheduleAfter);
          }

          messages.push({ role: "tool", tool_call_id: tc.id, content: text });
        }
        continue; // let the model read the tool results and continue
      }

      reply = (msg.content ?? "").trim();
      break;
    }
  } catch (err) {
    console.error("[concierge] turn failed:", err);
    return "Something glitched reaching my brain — give it another go in a moment.";
  }

  if (!reply) reply = "I wasn't able to finish that one — try rephrasing?";

  // Persist only the clean user + final-assistant text (tool scaffolding isn't replayed).
  const next: ChatMessage[] = [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: reply },
  ];
  saveHistory(chatId, next);
  return reply;
}
