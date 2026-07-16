# 02 — The Telegram Agent (@sagedeputybot)

> How the Telegram conversational agent actually works today, honestly: the message pipeline, the LLM concierge, the full tool set, and the walletless flow that lets a founder launch a real on-chain campaign from chat with no wallet app. Grounded in the code as of 2026-07-16, including what's proven, what's unproven, and the security caveats. File:line references throughout.

---

## 1. What it is + the headline result

`@sagedeputybot` is the **walletless front door** to the Deputy. A founder can, entirely from a Telegram chat with no browser and no wallet app: describe a product, get a mission plan, set up a policy-guarded agent wallet, fund it, and launch a real on-chain campaign that pays testers autonomously.

**The full walletless fund→launch loop was proven with real money on GOAT mainnet on 2026-07-16** — a real `CampaignVault` (`0x90169AB62B2bA1c61eEA442F179280Aba937E678`) was deployed and funded with 2 USDC entirely from a chat, via 4 Privy-signed transactions. This is the strategically-central surface: the founder's vision is "the chat is the account."

---

## 2. End-to-end flow: message → webhook → concierge → reply

**Entry:** `POST /api/telegram/webhook` (`src/app/api/telegram/webhook/route.ts`), `runtime="nodejs"`, `force-dynamic`.

1. **Auth gate** (`route.ts:25-31`): reads `TELEGRAM_WEBHOOK_SECRET`; unset → `404` (feature off). Compares the `X-Telegram-Bot-Api-Secret-Token` header via a constant-time `safeEqual`. Wrong/absent → `401`.
2. **Parse + extract** (`extractMessage`, `:86-103`): pulls `chat.id` + `text`. Malformed/no text → `200 {ok:true}` (never make Telegram retry).
3. **Rate limit** (`:45-47`): 20 messages/min/chat. Over → silent `200`.
4. **Branch on command kind** (`parseCommand`):
   - **Slash commands** (`/status`, `/agent`, `/start`, `/help`) → a **synchronous, deterministic path** (`buildReply`, `bot.ts:94-137`) built from **public data only** (campaign stats, ERC-8004 reputation card). No LLM, no wallet, no session state.
   - **Free-form text** → the **conversational agent**, but only if `conciergeEnabled()` (an LLM key is set).
5. **The `after()` deferred pattern** (`route.ts:57-72`) — the architectural heart. The concierge is **not awaited** before responding:
   ```
   after(async () => {
     const jobs = [];
     const reply = await runConcierge(chatId, text, (fn) => jobs.push(fn));
     if (reply) await sendTelegram(chatId, reply);
     for (const job of jobs) await job();   // drain scheduled background work
   });
   return NextResponse.json({ ok: true });   // returns immediately
   ```
   Telegram gets its `200` instantly; the model runs in the background; its final text is a *separate* outbound message; any work the tools scheduled (an inspection run, a poll-and-notify job) drains afterward.

**Critical runtime dependency:** this assumes a **persistent process** (deployed via pm2 on a VM). A poll-and-notify job can run ~3 minutes in-process; on a serverless host these deferred jobs would be killed.

**Outbound send** (`sendTelegram`, `bot.ts:50-79`): env-gated on `TELEGRAM_BOT_TOKEN`, 6s timeout, **never throws**. Command replies go as HTML; **all concierge free-form text is sent as plain text** so arbitrary model output can't trip Telegram's HTML parser.

**Not implemented:** message **chunking** for Telegram's 4096-char limit. Mitigated only by `max_tokens: 900`.

---

## 3. The concierge LLM

All in `src/lib/telegram/concierge.ts`. It is a **hand-rolled OpenAI-compatible chat-completions loop — it does NOT reuse the Deputy's `brain-core.ts`.** Deliberate isolation (comment at `:29-30`): it reads the same env directly so it "never imports — or risks changing — the frozen verification layer." The concierge and the Deputy share an *LLM endpoint and key*, nothing else.

### Model
- Endpoint: `LLM_BASE_URL` → `COMMONSTACK_BASE_URL` → `https://api.commonstack.ai/v1`.
- Model: `CONCIERGE_MODEL` → `LLM_MODEL` → `DEPUTY_MODEL` → hardcoded `"deepseek/deepseek-v4-flash"`.
- **Deployed value: `CONCIERGE_MODEL=anthropic/claude-haiku-4-5`.** So production runs **Claude Haiku 4.5** via the CommonStack gateway, while the committed default is a *different* model family (DeepSeek). This split matters: prompt-tuning was done against Haiku; a missing env var silently changes the agent's behavior. (This was upgraded from `gemini-3.1-flash-lite` during testing — the tiny model was the root cause of a hallucinated-URL bug and a real-money refusal bug; Haiku fixed both.)

Request params (`chatCompletion`, `:205-221`): `temperature: 0.3`, `max_tokens: 900`, `tools: TOOLS`, `tool_choice:"auto"`, 30s timeout.

### System-prompt blocks (`systemPrompt(chatId)`, `:44-90`)
Assembled conditionally on `privyConfigured()`: with Privy → `[BASE_PROMPT, READ_TOOLS, FUND_BLOCK, TAIL]`; without → `[BASE_PROMPT, HANDOFF_BLOCK, READ_TOOLS, TAIL]`. Then appends `This chat's id (use as clientRef): <chatId>`.

- **`BASE_PROMPT`**: identity + keep-it-short, and the **anti-hallucination rule** — only call `sage_start_inspection` for a URL the founder *explicitly* gave; never guess/default (google.com, example.com); on a bare "launch/go/funded" with no ready inspection, check wallet status and **ask**, don't invent. (This is a direct patch for an observed failure: after a restart wiped context, the model spun up a hallucinated google.com inspection.)
- **`READ_TOOLS`**: describes the 5 read/inspect tools, and tells the model the founder is **auto-messaged** when a plan is ready — so "don't tell them to poll, don't call `sage_get_inspection` yourself."
- **`FUND_BLOCK`**: the aggressive "you DO fund + launch, never defer to the founder" steering. "Deferring real-money funding back to the founder is a FAILURE, not caution." "NEVER DO YOUR OWN MONEY MATH" — call `sage_fund_and_launch` and relay its `overCap`/`needsFunding`/`needsGas` verdict rather than comparing budget to cap itself. "This chat is ALWAYS GOAT mainnet with REAL USDC." Teaches base-unit vs whole-dollar conventions (never quote a raw base-unit number). (Every one of these clauses was added to fix an observed real-money misbehavior: a weak model refused to fund, then misread `2000000` base units as "2 million mUSDC exceeds your $2 cap.")
- **`HANDOFF_BLOCK`** (Privy off): "prepare and report only, you do NOT hold keys," hand the founder the web `/launch/<id>` link.
- **`TAIL`**: "MONEY TRUTH" (USDC = real, mUSDC = testnet, report exactly as the tool returns) + STYLE (plain text, raw URLs, don't retry a failing tool in a loop).

### The tool-calling loop (`runConcierge`, `:234-311`)
- `messages = [system, ...history, {user}]`.
- Loops up to **`MAX_TOOL_ROUNDS=5`**. Each round: call the LLM; if it returns `tool_calls`, execute each **in-process**, push a `tool` result, continue; else take the content as the reply.
- **Server-side clientRef binding** (`:270-272`): before dispatch, if the tool is `sage_start_inspection`, it *forces* `args.clientRef = chatId`. The model is never trusted to pass the chat id (a null clientRef once collapsed idempotency into a shared namespace and lost chat linkage).
- **Dispatch split:** `isAgentWalletTool(name)` → `callAgentWalletTool(name, args, chatId)`; else → `callSageTool`.
- On any thrown error the turn returns a friendly string; empty reply → a rephrase prompt.

### Durable memory (an important fix)
History used to live in an **in-memory `Map`** that a pm2 restart (every deploy) wiped mid-conversation — after which a bare "launch" had no context and the model wandered. Now it's **DB-backed** via the `concierge_chats` table (`src/lib/db/concierge-chats.ts`):
- `loadHistory`/`saveHistory` read/write a JSON `ChatMessage[]` keyed by chat id, upserted each turn. **`MAX_HISTORY=12`** (trimmed to the last 12).
- Only **clean user + final-assistant text** is persisted — tool-call scaffolding is *not* replayed. The system prompt is prepended fresh each turn, never stored.

### Proactive notifications (`maybeNotifyOnInspection` + `buildInspectionNotice`, `:146-203`)
Keeps the "I'll message you when it's ready" promise. When an inspection starts, a poll job is scheduled: it polls `opGetInspection` up to 45× × 4s (~180s); on `ready`/`needs_input`/`failed` it builds a notice, appends it to history, and DMs it. Because the inspection's own run job is *also* scheduled and jobs drain sequentially, the inspection usually completes first, so the first poll DMs immediately (the 180s loop is a safety net). It fires even on an *idempotent re-request* (a previously-ready inspection DMs its plan at once — a fix for a case where a re-ask silently produced no follow-up).

**Fragility:** the notice DM is fire-and-forget; if it fails there's no retry/queue, and the whole chain dies if pm2 restarts during the ≤3-min window.

---

## 4. The full tool set

Tools = `[...MCP_TOOLS, ...(privyConfigured() ? AGENT_WALLET_TOOLS : [])]`. Agent-wallet tools are **deliberately excluded** from the public MCP registry — they exist only for @sagedeputybot, keyed on the founder's chat.

### Read / inspect tools (shared with the web REST API + `/mcp`; none can move money)
| Tool | Inputs | Output |
|---|---|---|
| `sage_start_inspection` | `productUrl, goal, targetUsers, budgetUsd, repoUrl?, clientRef` | `{ok, inspectionId, created, statusUrl, approvalUrl, note}` — SSRF-guarded, idempotent on `founder=clawup:<slug(clientRef)>` (the `clawup:` prefix is legacy from a dropped integration). |
| `sage_get_inspection` | `inspectionId` | `{stage, ready, productUrl, pagesInspected, needsInput, failure, plan{missionCount, budgetUsd, missions[...]}, approvalUrl}` — `plan` populated only when ready. **Now returns `budgetUsd`/`rewardUsd` (whole dollars), not just raw base units** — a fix for the model misreading `2000000` as millions. |
| `sage_get_campaign` | `campaignId` | funded/paid/remaining, missions, up to 25 submissions with each decision + payout tx + proof link. |
| `sage_get_submission` | `submissionId` | `{state, confidence, reason, payoutTx, proofUrl}` |
| `sage_get_proof` | `txHash` | `{state, settled, verified, outcome, network, recipient, explorerUrl, proofUrl}` — `verified` recomputed on-chain. |

### Agent-wallet tools (the only place chat can move money; `agent-wallet-tools.ts`)
| Tool | Inputs | Behavior |
|---|---|---|
| `sage_setup_wallet` | `perCampaignCapUsd` (1–100000) | If already set up, returns status. Else validates the cap, calls `onboardWalletless` (mints Privy wallet + mandate), returns the address to fund. |
| `sage_agent_wallet_status` | — | `{linked, walletAddress, balanceUsdc, perCampaignCapUsdc, reclaimAddress}` — reads live USDC balance on-chain. |
| `sage_fund_and_launch` | `inspectionId` | The core action. Auto-approves the plan revision (the mandate *is* the pre-authorization), computes budget, then guards in order: over-cap → `{overCap}`; balance < budget → `{needsFunding}`; native gas < ~0.000003 BTC → `{needsGas}`. If all pass, calls `deployCampaignViaPrivy` and returns `{campaignId, vault, campaignUrl, launchTxs[]}`. |
| `sage_request_withdrawal` | `amountUsd, toAddress` | Validates address + amount ≤ balance, stores a pending withdrawal (in-memory, 5-min TTL). **Moves no funds.** |
| `sage_confirm_withdrawal` | — | Consumes the pending withdrawal one-shot, calls `withdrawViaPrivy`. Expired/missing → error. |

`callAgentWalletTool` never throws — errors become `{ok:false, error}`. All money math lives here, not in the model.

---

## 5. The walletless flow in detail

Chain: **GOAT Network, chainId 2345, mainnet**, USDC `0x3022b87ac063DE95b1570F46f5e470F8B53112D8` (6 decimals), native gas token **BTC**.

### 5a. Wallet minting (`onboardWalletless`, `onboarding.ts:77-106`)
1. Resolve GOAT config (requires factory + operator + USDC addresses).
2. **Create the mandate policy** in Privy — **no `reclaim`, so no sweep rule** (leftover stays as balance).
3. **Create a Privy server wallet born under that policy** — `policy_ids` attached at birth, so it can never sign outside the mandate.
4. **Bind** chat ↔ wallet in `agent_wallets`. For walletless, `founderAddress` is set to **the Privy wallet's own address** (see the guardian caveat in 5d).

Privy REST auth: `Basic base64(app_id:app_secret)` + `privy-app-id` header.

### 5b. The mandate / policy — exact rules (`buildMandatePolicy`, `mandate.ts:57-83`)
A Privy policy, default-deny, with these ALLOW rules on `eth_signTransaction` (all amounts read from **decoded calldata**):
1. **create vault** — `to == factory` only.
2. **approve ≤ cap** — `to == usdc` AND `approve.amount ≤ perCampaignCapBase`.
3. **fund ≤ cap** — `fund.amount ≤ cap`.
4. **activate** — `function_name == "activate"` (moves no money).
5. **sweep** — *only added if `reclaim` is set* → **omitted in the walletless path.** Leftover stays as balance. (Unit-tested: the walletless mandate has exactly 4 rules, none matching "sweep.")

**Total lifetime spend is bounded by the wallet's balance** (the founder funds what they intend to spend) *and* the per-campaign cap bounds any single campaign.

**Honestly documented v1 gap** (`mandate.ts:18-19`): the `approve` rule pins the USDC contract and amount but **does not pin the spender to a Sage vault.** Worst case for a compromised agent = a single `approve` at the per-tx cap (further bounded by balance). The noted v2 fix (a fixed "funding router") is **not built.**

### 5c. Funding
Manual: the founder sends **USDC** and **a little native BTC for gas** to the address the tool returns. The tools read live balances to gate.

### 5d. The 4-tx deploy (`deployCampaignViaPrivy`, `deploy-runner.ts:43-113`)
Builds the **exact same `create → approve → fund → activate` bundle the web app uses**, with `owner = the Privy wallet`:
- `create` → factory `createCampaignVault(...)`; `approve` → USDC `approve(predictedVault, exactBudget)` (**exact, never unlimited**); `fund` → vault `fund(budget)`; `activate` → vault `activate()`.
- The vault address is a **deterministic CREATE2 prediction**, so approve/fund can target it before it exists.
- Each call is signed via Privy + broadcast by Sage, **strictly sequentially** (each confirmed before the next is built).

**GOAT gas handling** (`executor.ts:47-67`) — the load-bearing detail: GOAT **rejects a priority tip below 130000 wei** (base fee is single-digit wei, so a plain legacy `gasPrice` produces ~0 tip and is refused). So each tx is **EIP-1559** with `max_priority_fee_per_gas = 500_000 wei` (≈4× the floor) and `max_fee_per_gas = 1.2 × baseFee + tip`. (This exact bug blocked the first funded deploy attempt — the executor was sending legacy txs; the fix made the mainnet loop succeed.)

After the 4 txs, `attachV2Campaign` records the campaign — the same atomic attach the web app uses, which re-reads the on-chain vault and fails closed unless it matches the approved plan. Result: `autonomy:"autopilot"`.

**Honest guardian caveat:** the deploy sets `guardian = wallet.founderAddress`, commented "the founder's real SIWE wallet is the guardian." **In the walletless path this is false** — `founderAddress` is the Privy wallet's *own* address, so **owner == guardian == the Privy wallet.** The guardian, meant as an independent safety backstop, provides no independent oversight in the proven flow. Validation enforces `owner ≠ operator` and `guardian ≠ operator` but **not** `owner ≠ guardian`, so this passes.

### 5e. Withdraw (scoped-policy swap, `withdraw.ts:34-68`)
The base mandate denies **all** transfers, so a withdraw can't just be signed:
1. `createWithdrawPolicy` mints a **scoped policy** = the full base mandate **plus one** ALLOW: `transfer` on USDC where `transfer.to == target` AND `transfer.amount ≤ maxBase` (recipient + amount pinned).
2. `setWalletPolicies` swaps the wallet onto it (Privy = one policy per wallet).
3. Execute the single `transfer`.
4. **`finally` → `restoreBasePolicy`** re-locks to the base policy (3 retries, 500ms backoff; total failure logs `CRITICAL` but doesn't throw).

The scoped policy pins recipient + amount, so even a lingering attachment can only move ≤ maxBase to the founder's chosen address. **This path is built and unit-tested for the policy shape, but NOT yet proven on-chain** (no confirmed mainnet withdrawal execution).

### 5f. Custody / trust model — stated honestly
- **Privy custodies the keys.** Sage never holds the raw private key; it asks Privy to create wallets, attach policies, and sign — then broadcasts the signed tx itself.
- **The mandate is the deterministic safety core.** A tx outside the policy is refused *inside Privy's enclave, before a signature exists*, independent of the LLM. The model can be jailbroken and still cannot exceed the cap, hit a non-allowlisted address, or move money anywhere but a chat-authorized withdrawal target.
- **But whoever holds `PRIVY_APP_SECRET` controls every founder wallet.** Privy authenticates on the app secret alone — no per-wallet key, no per-request user signature. **This is the single largest trust assumption in the system**, and rotating the (previously in-chat-exposed) secret is an outstanding item.

---

## 6. Integrations used

- **Privy server wallets + policies** — the walletless custody + mandate layer. Proven for wallet-create + `eth_signTransaction` on GOAT.
- **CommonStack LLM gateway** running **Claude Haiku 4.5** in production. Same endpoint/key as the Deputy brain, but a **separate hand-rolled loop** — the concierge does not reuse `brain-core.ts`.
- **Sage inspection/deploy ops** — the 5 read tools reuse the exact `operations.ts` the web app uses; the deploy reuses the web app's `deploy-plan.ts` + `attachV2Campaign` unchanged.
- **ERC-8004 + campaign stats** — only via the deterministic slash-command path, not the LLM.
- **x402** — not in the Telegram path (it's the tester-payout metering rail on the campaign side).
- **LazAI** — not integrated anywhere.

---

## 7. What is REAL/PROVEN vs incomplete/unproven

**Proven / real:**
- The full **walletless fund→launch loop on GOAT mainnet** (real vault, real 2 USDC, from chat, 2026-07-16). The 4-tx Privy-signed deploy with the 500000-wei GOAT tip works.
- The webhook → concierge → tool-loop → reply pipeline, including `after()` deferral and proactive inspection DMs, on a persistent pm2 process.
- **Durable per-chat memory** (`concierge_chats`) — fixes the restart-wipe/hallucination bug.
- The **mandate policy builder** — the only part with real unit tests (cap on approve/fund, factory-pinned create, no-sweep walletless, scoped withdraw pinning). Enforced by Privy's enclave, not app code.
- Read/inspect tools — mature, shared with the web app, SSRF-guarded, idempotent.

**Incomplete / unproven / fragile:**
- **The withdraw path is UNPROVEN on-chain** — no integration test, no confirmed mainnet execution; the pending-withdrawal store is an in-memory Map (a restart between request and confirm drops it).
- **The entire SIWE-linked onboarding path is DEAD CODE / unreachable** — `createLinkToken`/`peekLinkToken` have *zero callers*; there's no `/link` Telegram command and no tool that mints a link. So `/link/[token]`, `link-client.tsx`, `/api/tg/link`, and `onboardFounder` are a polished but **orphaned** feature. Only the walletless path is live. (Consequently the "leftover sweeps back to your wallet" copy shown there is moot — the reachable flow has *no sweep rule at all*.)
- **The "guardian" is neutered** in the proven flow (owner == guardian == the Privy wallet).
- **No web parity** for a walletless founder to manage/reclaim a chat-launched campaign outside the two withdrawal tools.
- **No message chunking** — long replies can exceed Telegram's 4096-char limit.
- **Single-model reliance / config split** — production depends on `CONCIERGE_MODEL=anthropic/claude-haiku-4-5`; the committed fallback is a different model family. All prompt-steering was tuned against Haiku.
- **Prompt-injection surface** — money can't be stolen past the mandate, but a jailbroken model could start unwanted inspections or over-eagerly launch a funded campaign (bounded by cap + balance).

### Top security caveats (ranked)
1. **`PRIVY_APP_SECRET` is a single master credential for all founder wallets** — no per-wallet auth. Compromise = control of every agent wallet within their attached policies. Rotation is open.
2. **`approve` spender is not vault-pinned** (self-documented v1 gap) — worst case one cap-bounded approve.
3. **Withdraw re-lock can fail** and leave a scoped (still recipient+amount-pinned) policy attached; only logged, not alerted.
4. **The whole background layer depends on one persistent pm2 process** — no queue, no retries; a restart loses in-flight notifications, pending withdrawals, and link tokens.

**Net:** the economic safety story is genuinely strong where it counts (the enclave-enforced mandate makes overspend/misdirection impossible regardless of the LLM), but the surrounding operational and custody layers are early — one master secret, one process, one model, an unproven withdraw, and a fully orphaned SIWE-link feature shipping next to the live walletless one.

---

## 8. Questions this raises for improvement

1. **Custody honesty vs. magic.** Chat-as-account is the magic; the one-master-secret custody model is the liability. What's the right architecture — per-founder auth keys? user-signed authorizations? a real independent guardian? — that keeps the zero-friction feel?
2. **Operational resilience.** The whole background layer is one pm2 process with no queue. What's the minimum durable-job infrastructure to make notifications/withdrawals reliable?
3. **Prove and productize withdraw + reclaim.** Money out is the other half of trust and it's unproven. A walletless founder needs a clear, safe way to get their funds and manage a campaign.
4. **One onboarding path.** A polished SIWE-link flow ships dead alongside the live walletless one. Consolidate to one, and decide whether the web app should adopt the walletless model.
