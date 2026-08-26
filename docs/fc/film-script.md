# The film — "Say the work. Sage verifies. Sage pays."

**Target: 3:30–4:00. Every frame is real product or real receipts — no mockups, no staged data.**
Voice: calm, first person ("I built…"), the receipts do the selling.

---

## Shot list

### 1 · Cold open — the ledger (0:00–0:20)
**Screen:** slow scroll of [sagepays.xyz/explorer](https://sagepays.xyz/explorer) — settlements in green, refusals in red, the refusal-share stat visible.
**VO:** "Every payment on this screen was decided by an AI agent. So was every refusal. No human reviewed any of them — and every line links to an on-chain receipt."

### 2 · The problem, in the region's own numbers (0:20–0:45)
**Screen:** three plain title cards (no stock footage): "7–9% — average transaction fees" · "80–90% of Caribbean businesses are MSMEs" · "Most have no credit file a lender can trust."
**VO:** "In the Caribbean, moving money is expensive, and the businesses that ARE the economy can't borrow — not because they aren't good, but because nothing trustworthy records that they are. Sage attacks both with one loop."

### 3 · Say the work (0:45–1:35)
**Screen:** Telegram screen-recording, real chat with @sagedeputybot:
- type: *"Create a gig campaign… two deliverables, each pays $0.50…"* → the plan card appears (show the compiled milestones + verification contract)
- type: *"launch it with agent wallet"* → **Campaign live** + vault address + funded amount.
**VO:** "You say the work once — in a sentence. Sage compiles it into missions with a verification contract, then funds an on-chain vault with hard caps. From here it spends without me — but it can never spend outside the vault's limits. The AI proposes; the vault disposes."

### 4 · The work happens — a human and an AI, same rules (1:35–2:25)
**Screen A (walletless human):** second phone/account — open the `t.me` invite link → the chat becomes the account (no wallet app, no seed phrase) → submit the deliverable from chat → the **paid push** with the receipt link.
**Screen B (the AI worker):** terminal running `agent-worker.mjs` — the log lines: *discovered over public MCP → published my deliverable → signed the same claim a human signs → PAID* → cut to [the $0.50 receipt](https://sagepays.xyz/proof/0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827).
**VO:** "Recipients don't need a bank or a wallet app — chat is the account. And 'worker' includes other AIs: this agent found the job over the public API, did real work, signed the same claim a human signs, and was paid by the same vault. The agentic economy, as a transaction hash."

### 5 · The refusal (2:25–2:50)
**Screen:** the real held submission — the founder push: *"Held… 'Love win and trade'… the page couldn't confirm this work"* — then the explorer's refusal share stat.
**VO:** "Within an hour of going live, a stranger submitted spam. Sage's deterministic layer refused it before spending a cent — or a single model call. Around forty-five percent of judged submissions are refused, with the reason on the record. That discipline is the product: a rail that pays everything is just a leak."

### 6 · The credit layer (2:50–3:25)
**Screen:** [the AI's work record](https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d) — scroll the Sage Signals card, then flash the raw JSON of `/api/record/<wallet>`.
**VO:** "Every verified payout accrues to a public work record with deterministic credit signals — pass rate, verified inflow, tenure, distinct funders. Not a score we invented: published formulas over receipts. A thin file that's true beats a thick one that's self-reported — and it's exactly the cash-flow history collateral-based lending is missing. This is the MSME credit layer, growing as a byproduct of getting paid."

### 7 · Close (3:25–3:45)
**Screen:** the landing hero → the Loop scene's receipts panel.
**VO:** "Product tests, gigs, milestone grants — one loop pays them all: define, verify, pay or refuse, receipt, record. Built solo. Live on GOAT Network mainnet with real USDC. sagepays.xyz."

---

## Capture checklist (one sitting)

- [ ] Explorer scroll (desktop, clean profile, no bookmarks bar)
- [ ] Telegram: the gig creation + launch exchange (crop to chat; re-run with a fresh $1 gig if the original scrolled away — the flow is one message now)
- [ ] Second account: invite link → walletless onboarding → submit → paid push
- [ ] Terminal: `AGENT_WORKER_KEY=… node scripts/agent-worker.mjs --base https://sagepays.xyz --campaign <id> --publish` (font ≥16pt, dark terminal)
- [ ] The held-submission push (already in your chat history — screenshot/screen-record it)
- [ ] /record + /api/record JSON, /proof of both hero receipts, landing scroll
- [ ] Title cards: render as plain slides in the deck tool, export PNG

**Rules:** no fabricated numbers on screen; if a live stat moved since this script, say the live number. Keep "Alhamdulillah" out of the VO (personal, as agreed) — gratitude beat goes at the end card: "Thanks to GOAT Network, Metis, and the Future Caribbean partners."
