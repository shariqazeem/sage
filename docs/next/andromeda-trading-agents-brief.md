# Brief: AI trading agents with records they can't fake, on Metis Andromeda

*For a fresh session. Written 14 Oct 2026; three pillars locked the same day. Clone `github.com/shariqazeem/parallaxpay_x402` into a NEW repo
under a new name; leave the original untouched. Keep ParallaxPay's UI/UX (the founder loves it).*

## The one line

**A marketplace of AI trading agents where every call is written on Metis *before* the outcome, so each
agent's track record is public, permanent and impossible to fake.** Users pay per call or subscribe, in
METIS or m.USDC on Andromeda.

The idea that makes it different: signal sellers usually show screenshots. Here the agent commits a
fingerprint of each call on chain before the market moves, and resolves it afterwards automatically. The
hit rate becomes the agent's on-chain reputation (ERC-8004). Good agents earn trust in public; bad ones
can't hide.

## Why this fits Metis Rise (read the rules first)

- **Ranking:** 80% monthly active users, 20% METIS gas used. You qualify with **15+ valid users/month**,
  each with **3+ transactions on Andromeda OR $2+ settled** (m.USDC, m.USDT or METIS).
- **Mapping:**
  - **Subscription** (e.g. $3/month for ST Quant signals, paid on Andromeda): each subscriber is $2+
    settled, so one subscriber is one counted user.
  - **Pay-per-call Oracle** (a few cents a call): three calls a month and the user counts.
  - **Creators (pillar 3):** deploying an agent (registration), confirming its spec and claiming
    earnings are transactions from the creator's own wallet. An active creator is a counted user too.
  - **Gas:** every commit, every resolution, every payment and every claim is an Andromeda transaction.
- **Their stated fit:** "agents that need payments (x402), identity (ERC-8004), stablecoin escrow, or
  verifiable receipts." This project uses payments, identity and receipts.
- **Timing:** apply in **October** (before **31 Oct**) and you're ranked in **November**. The form needs
  your **contract addresses on Andromeda**, so deploy first, then apply.
- **Reality check (measured 14 Oct):** Metis Andromeda DeFi is tiny. DefiLlama shows 6 pools, about $0.2M
  in total. So trading does NOT happen on Metis. **Metis is the trust and payment layer**: commits,
  receipts, identity, subscriptions. Signals cover the coins and chains where trading actually happens
  (ST Quant: BSC and X Layer; Oracle: any major coin).

## What already exists (reuse, don't rewrite)

| Source | Take |
|---|---|
| **ParallaxPay** (`parallaxpay_x402`) | The whole UI/UX, the agents marketplace and dashboard, the **Market Oracle** (multi-model consensus with accuracy tracking: `lib/market-oracle-agent.ts`), agent identity cards and leaderboard, x402 payment hooks (`useX402Payment`, `x402-payment-client`), MCP server. Strip the Solana, Helius, Gradient Parallax and Supabase-specific parts as needed. |
| **ST Quant** (`~/projects/okxtradingagent`) | The real trading brain: `scanner`, `structure` (levels and trendlines), `indicators` (MFI percentile), absorption, `analyst` (vision chart read), `exits`, `limits`. Docs: `HOW-IT-WORKS.md`, `STRATEGY.md`, `EVAL.md`. **Status: never proven profitable, by its own docs.** It has been running as `st-quant/src/scanner.js` on the VM. |
| **Sage** (`~/projects/SAGE`) | ERC-8004 registration (`scripts/register-erc8004.mjs`), the public receipt page pattern (`/proof/<tx>`), x402 rail experience, bounded-autonomy ideas (mandate and vault limits), deploy scripts. |

## The product, v1 (what ships for Metis Rise): three pillars, LOCKED by the founder 14 Oct

1. **Oracle** (from ParallaxPay): ask about any major coin and get direction, confidence, horizon and
   reasoning. **Pay per call** (x402 on Andromeda). Every call is committed before the horizon and
   resolved after.
2. **ST Quant signals** (from okxtradingagent): real setups (entry at support, stop, target, conviction,
   chart image), committed on Andromeda the moment they fire, resolved by price automatically. A
   **monthly subscription** paid on Andromeda unlocks the signals and Telegram alerts as they happen.
   Delayed or free views can show the closed record so anyone can audit it.
3. **Deploy your own agent:** a user writes their strategy roughly, in plain English ("buy when 15m MFI
   is at its lowest at a rising trendline, stop below the line, target the last rejection"). Sage-style
   compiling turns it into a **strategy spec** (ParallaxPay's `lib/nl-agent-builder.ts` is the seed). The
   agent goes live, scanning on a schedule with ST Quant's data and indicator modules and **committing its
   calls on chain like the others**. Once it has a public record, **anyone can subscribe to it, and the
   creator is paid a share of every subscription** in m.USDC on Andromeda.

**The public record ties all three together:** a leaderboard of agents by real resolved results (hit
rate, average R, number of calls, losses included), each agent with an ERC-8004 identity whose reputation
is its record. Every call links to its on-chain commit and its resolution, the same pattern as Sage's
receipt pages.

### Rules for pillar 3 (these make it trustworthy, and they are part of v1)

- **A strategy is data, never code.** The AI compiles plain English into a fixed spec (indicators,
  conditions, levels, timeframes, risk rules) drawn ONLY from a library the platform runs. No user code
  ever executes on the server. If the spec can't express the request, say what's missing and refuse
  rather than guess (Sage's "never invent a step" rule).
- **Show the compiled rules back to the creator** in plain words before it goes live. They confirm it.
- **No subscriptions until the agent has a record:** for example 10+ resolved calls over 7+ days, all
  committed before their outcomes. An empty agent can't sell hype.
- **Nothing gets deleted.** A creator's every agent, including the abandoned and losing ones, stays on
  their public profile. This stops "launch 20, show the one that got lucky".
- **Signals only in v1:** the agent alerts and records; nobody's funds are touched. Automated execution
  is a later phase, and only with limits enforced in code ("the AI proposes, the vault disposes").
- **Creator payouts are on chain:** the subscription contract splits each payment (e.g. 80% creator,
  20% platform) and creators **claim** their earnings. Each claim is a transaction from their own wallet.

## On Andromeda (chain 1088): what to deploy, then put on the form

- **CallRegistry:** `commit(agentId, hash)` before the outcome, then `resolve(callId, reveal, outcome)`
  after. Emit events. This is the "can't fake it" core and most of the gas.
- **Payments:**
  - **pay-per-call:** an x402 flow or a simple `pay(callRequestId)` in METIS or m.USDC;
  - **Subscription:** `subscribe(agentId)` for 30 days, in m.USDC or METIS. The contract splits each
    payment between the agent's creator and the platform, and `claim()` pays a creator their share.
  - **AgentRegistry:** `register(specHash)` by the creator's wallet. The spec's hash is on chain, so a
    strategy can't be quietly changed after its record starts; a changed spec is a new agent.
- **Identity:** ERC-8004. **Verify first** whether Metis has a deployed ERC-8004 registry and an x402
  facilitator (Metis's program text implies support). Otherwise deploy minimal versions.
- **Verify the token addresses on chain before using them:** m.USDC, m.USDT and METIS, including
  decimals, by reading them through the RPC rather than trusting memory.

## Guardrails (non-negotiable)

- **Never custody user funds.** Signals are information; people trade in their own wallets.
- **No promised returns.** No "profit", "guaranteed" or "win rate" claims beyond the on-chain record
  itself. Say "not financial advice" plainly. The record shows losses as prominently as wins.
- **Commit every call before its outcome, and never edit or delete one.** That integrity is the whole
  product.
- **Say ST Quant is unproven** until the public record says otherwise. The record starts on day one.
- Before taking money for signals, check what subscription signal services need in the founder's
  jurisdiction.

## Plan (deadline: apply by 31 Oct; ranking runs through November)

- **Days 1–2:** clone and rename. Keep the UI. Switch wallets to Metis Andromeda (EVM, wagmi/viem,
  chain 1088). Remove Solana-only pieces.
- **Days 3–5:** contracts (CallRegistry, AgentRegistry, Subscriptions with the creator split, claim),
  tested on Metis Sepolia, then deployed to Andromeda. The Oracle commits and resolves on chain, and
  pay-per-call works end to end.
- **Days 6–8:** ST Quant pipeline. Signals commit on chain, Telegram alerts go to subscribers, and the
  subscription is paid on Andromeda. Build the leaderboard and receipt pages.
- **Days 9–12:** deploy your own agent:
  - plain English to strategy spec, shown back for confirmation;
  - the runner, which reuses ST Quant's data and indicators;
  - registration on chain, with calls committed and resolved;
  - the creator profile, the record threshold before subscriptions, and creator earnings and claims.
- **Day 13:** ERC-8004 identities for the Oracle and ST Quant (and each deployed agent). **Fill the Metis
  Rise form** with the real contract addresses and the live URL.
- **Days 14–17:** the first users (below), plus fixes from real use.

## The first 15 users (name them before building)

People who already watch charts: the founder's trading circles and Telegram groups, OpenClaw bootcamp
peers, Metis community channels, and Metis's builder livestream and leaderboard (offered in the
program). The pitch that travels: *"Every call this AI made is on chain from before it happened. Check
the record."* One paid subscriber or three paid Oracle calls in a month makes a counted user.

## Open decisions for the founder

- The new name.
- Prices: per Oracle call, the ST Quant subscription, and whether creators set their own price.
- The creator split (e.g. 80/20), and the record threshold before an agent can take subscribers.
- Which coins and chains the signals cover in v1.
- Whether the subscription unlocks live signals only, or live signals plus Oracle calls.
