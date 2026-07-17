# Sage — hire an AI worker. Give it a budget, not your keys.

> A founder points Sage at a product URL with a budget. Sage inspects the product,
> designs paid testing missions, deploys an on-chain vault, and then **autonomously
> pays human testers USDC for verified evidence — inside hard on-chain limits it can
> never exceed.** Every payout cites its evidence and is published as a verifiable
> `/proof/<tx>` receipt.

**The value is bounded autonomy over money.** The agent spends without a human in the
loop, but the *vault* — not a prompt — enforces the limits. **The AI proposes; the vault
disposes.** Anything off-policy is blocked on-chain *before* funds move, even if the model
is wrong or jailbroken.

---

## Get started in 60 seconds

No wallet app, no signup. Message **[@sagedeputybot](https://t.me/sagedeputybot)** on
Telegram and send `/start`. Then tell it what to test and a budget — e.g.
`test my product at https://yourproduct.com, budget $10`. Sage inspects your product and
DMs you a mission plan in about two minutes; **nothing is charged until you fund it.**

## Live

| | |
|---|---|
| **App** | https://sagepays.xyz |
| **Walletless founder** | [@sagedeputybot](https://t.me/sagedeputybot) — run an entire campaign from Telegram: inspect → fund → autonomous payouts → review held work, no wallet app |
| **A public tester board** | e.g. [`/c/<slug>`](https://sagepays.xyz) — do a mission, get paid real USDC on GOAT mainnet |
| **Agent identity** | [`/agents/sage`](https://sagepays.xyz/agents/sage) · ERC-8004 **#79** on [8004scan (chain 2345)](https://8004scan.io/agents?chain=2345) |
| **A real autonomous payout** | [proof receipt](https://sagepays.xyz/proof/0xd2483e5cfccd7dbe979683dfd8948cf9b022fe7348fa81fa127f91e785a8ffc4) — real USDC on GOAT mainnet (more on [`/agents/sage`](https://sagepays.xyz/agents/sage)) |

## Why it's different

- **The AI cannot be jailbroken into paying.** The judgment brain is hardened with
  untrusted-data delimiters, an 8-family server-side injection detector, verbatim-quote
  enforcement, and a confidence ceiling — and the vault is the final gate regardless.
  The red-team suite (`tests/redteam/`) guards it in CI.
- **It actually plays the product.** With the Field Test on, Sage explores the product in a
  real headless Chromium *as a state machine* — waiting out loading screens, clicking into an
  interactive app, and **reading each screen with a vision model**. It understands a wordless
  game (yara.garden → *"interactive game, titled Yara"*), not a guess from the HTML.
- **Missions can't be hallucinated.** Every mission carries verbatim anchors, and a
  deterministic gate rejects any claim that isn't a literal substring of what Sage actually
  observed — a *"Validate Zoom Control"* for a control that was never there cannot reach a
  founder, whatever the model says. When observation is too thin, Sage asks instead of inventing.
- **Autonomy with judgment, not a rubber stamp.** Sage **pays what it can verify** (a public
  URL + quoted text settles automatically) **and holds what it can't** — an interactive-app
  result it can't prove from a URL is held for a one-tap founder approval from Telegram, never
  auto-paid on a guess. Corpus cross-verification of written accounts (against what Sage saw
  but the tester never did) closes that loop next.
- **Verifiable, not vibes.** Every decision cites the exact evidence it read; every payout
  is a public `/proof/<tx>` page a stranger can re-check on-chain.
- **Observable autonomy.** The tester board shows a live "Sage activity" feed — received,
  verified (with confidence), paid, held, blocked — projected only from real rows, never
  fabricated, with a zero-evidence-leak guarantee.
- **Accountable.** Reputation is derived from real on-chain settlements and anchored to an
  ERC-8004 identity — a track record, not a self-assertion.

## How it works

One intent, two human moments. The founder states **URL + goal + budget** once; the only
two things they ever *do* are **approve the plan** and **fund it**. Everything else Sage
does autonomously and narrates after acting, with an artifact behind every claim.

1. **Inspect** — Sage fetches (and, with the Field Test, really browses) the product and
   builds a structured map.
2. **Design** — the Mission Brain drafts specific missions (architect → critic → a
   deterministic validation gate; model output is untrusted until it passes the gate).
3. **Deploy** — a founder-owned `CampaignVault` is created and funded on-chain, with hard
   per-mission rewards, completion caps, and a total budget the agent cannot exceed.
4. **Pay** — testers submit a public evidence link + note (bound to their wallet by a free
   EIP-712 signature). The Payout Brain judges the evidence against the criteria; on high
   confidence the vault settles USDC automatically and publishes the proof. Borderline work
   is **held** for the founder — who can release or reject it right from Telegram.

## Architecture

Three separate LLM "brains" + one on-chain settlement core — separate on purpose.

| Component | Role |
|---|---|
| **Mission Brain** | *Designs* missions: architect → critic → deterministic validate gate. |
| **Payout Brain** | *Judges* tester evidence and proposes pay / review / hold. **Never states an amount.** |
| **Telegram Concierge** | The walletless front door — a hand-rolled tool loop that deliberately never imports the judgment layer. |
| **Vaults + settlement** | `CampaignVault` derives the exact reward, enforces caps + replay protection, and emits the settlement event that is the single source of truth. |

**Invariants the code enforces:** no model ever computes a money amount (rewards come from a
deterministic budget compiler); quotes in a decision must be verbatim substrings of the
fetched evidence; untrusted content stays inside `<<<UNTRUSTED_…>>>` markers; mainnet
auto-pay is gated behind a flag and a confidence threshold; the activity feed never
fabricates progress. The safety-critical pieces (injection detector, autopilot gate, mandate
policy builder, vault ABIs, budget math) are treated as frozen and guarded by tests.

**Chains.** GOAT Network (chainId `2345`, real USDC, native gas BTC) is the production
mainnet; Metis Sepolia (`59902`) is the testnet.

**Two front doors, one engine.** Web (`sagepays.xyz`): connect a browser wallet, SIWE,
guided launch. Walletless Telegram (`@sagedeputybot`): Sage mints a policy-guarded server
wallet and funds/launches/reviews from chat — no wallet app.

## Run it

```bash
npm install
cp .env.example .env      # fill in what you have; missing integrations degrade honestly
npm run dev               # http://localhost:3000
npm run test              # unit/component + the red-team suite
npm run build             # production build
npm run preflight <chatId> # go/no-go check before a real campaign
```

Sage degrades honestly: with no LLM key the judgment brain drops to a transparent keyword
heuristic that **can never auto-pay**; with no x402 creds evidence verification falls back to
unpaid; a missing integration means it's *pending*, not broken. See `CLAUDE.md` for the full
spec and the environment table.

## Stage 1

See **[STAGE1.md](STAGE1.md)** for the deliverables + proof, and **[GROWTH.md](GROWTH.md)**
for the seed-user definition and growth metrics.
