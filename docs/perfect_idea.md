# Sage — Payout Deputy · LOCKED SPEC (the paper)

> This is the single source of truth. The idea is **locked**. Every change from
> here happens **inside the build**, not in the concept. Survived four rounds of
> pressure (Sage → Launch → Ops → Payout) and passes the 7-test 7/7.

---

## 0. The one-line lock

**Sage lets you hire an AI worker, give it a budget and a rule, and let it pay
real people for real completed work — autonomously — without ever handing it your keys.**

- **Sage** = the platform (premium tabbed ecosystem app).
- **Deputy** = the worker you create inside Sage.
- **Payout Deputy** = the v1 flagship worker.
- **Policy Vault** = the leash (live on-chain).
- **The promise:** *Confirm the policy once. The Deputy acts autonomously inside
  it. The vault blocks everything outside it.*

**Lineage line (we were accepted as "Sage"):**
> "We started as an evidence-backed decision agent. During the bootcamp we
> realized the missing layer wasn't more AI *judgment* — it was safe *execution*.
> So Sage became the control layer for AI workers that spend real money without
> going rogue."

---

## 1. The product

**Payout Deputy verifies that a real task happened, then releases the right
payment to the right person from a capped vault — and physically cannot do
anything else.** The wedge: **bounty & reward payouts for builder / agent
communities** (every team beside us in the cohort runs these — they're the
customer the day we ship).

**Why this wedge** — two lanes on the competitor slide are taken: **Triage**
(OSS-PR rewards) and **PayMate** (freelancer billing). We do the opposite:
autonomous *outbound conditional release*, not human-initiated billing. The
enforcement lane is **empty** — nobody else owns "spends real money, physically
can't go rogue."

### The core mechanic — two guarantees that compose (this is what makes it demo-proof)
1. **The condition is machine-checkable** — an accepted submission, an on-chain
   proof, a completed form, a hit deadline. **Never** a subjective "is this work
   good?" call. (This is the single most important design rule — it keeps the
   fragile, fakeable part off the critical path.)
2. **The vault makes the money safe even if everything else breaks** — wrong
   amount, wrong recipient, post-revoke, over-budget: all physically impossible.

Checkable condition **+** hard enforcement = **no moment in the live demo can go
wrong.**

### What the AI actually does (so it's a worker, not a script)
1. monitors the condition source, 2. reasons whether the condition is genuinely
met (matches submission to criteria, dedupes, anti-spam), 3. pays for any gated
verification/data it needs (**x402** load-bearing), 4. computes the correct
payout, 5. proposes the spend — **the vault enforces**, 6. runs across many
bounties/recipients with zero re-confirmation inside policy, 7. emits a
decision + receipt for every action (the proof trail).

> **Guardrail:** the agent decides *who and how much*; the vault decides *whether
> money can move.* Both must be genuinely real, or it reads as "escrow with a watcher."

---

## 2. The 7-test scorecard (why it's locked)

| Test | ✅ | Why |
|---|---|---|
| Spend is load-bearing | ✅ | The job *is* paying — you can't "pay the winner when the task is done" without real money moving. |
| There's a tomorrow | ✅ | Communities run bounties continuously; standing mandates ("pay each accepted submission as it lands") = retention. |
| The leash is the hero | ✅ | Autonomously sending real money to real people is genuinely dangerous with raw keys — the vault is the reason you say yes. |
| Real economic activity (#1 grading line) | ✅ | Real USDC to real humans. Un-fakeable. |
| Empty lane | ✅ | Commerce/billing/marketplace/monitoring taken; enforcement empty. |
| Week-1 rail risk | ✅ already solved | Wallet-to-wallet USDC via `requestSpend` is built + verified on-chain. |
| 90-sec relief demo | ✅ | Set policy once → it pays → try to break it → blocked on-chain. |

---

## 3. Integrations — all load-bearing (from the GOAT builder docs)

| Integration | Role | Concrete facts |
|---|---|---|
| **Policy Vault** (Metis Sepolia → GOAT) | the leash + the payout | Already deployed + verified. Portable Solidity (paris EVM) → moving to GOAT is config + redeploy. |
| **GOAT x402** | pay for gated verification/data | REAL facilitator exists: merchant portal `x402-merchant.goat.network` + `npm i goatx402-sdk-server`. **Min payment 0.1 USDC.** Kills the "demo vendor" caveat. |
| **ERC-8004** | Deputy identity + work history | Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on **GOAT mainnet (chain 2345)**. **SUBMISSION GATE: agent must appear on `8004scan.io/agents?chain=2345`.** History = real settled payouts (grounded reputation). |
| **Snaplii gift cards** | optional "it can also buy things" beat | `giftcard.goat.network`, supports GOAT + Metis. Syntax: `Buy a [VALUE] [COMPANY] gift card on [CHAIN] and pay with USDC`. Demo flourish only — not a product. |
| **AgentKit** | wallet mgmt + on-chain ops | `github.com/GOATNetwork/agentkit`. |
| **GOAT / Metis / OpenClaw / OKX** | ecosystem home + Stage-2 $1M grant | Build native to the stack. |

**Chains:** GOAT mainnet (chain 2345, `rpc.goat.network`, USDC `0x3022b87a…`) · GOAT
testnet (`explorer.testnet3.goat.network`) · Metis Sepolia (vault live today) ·
Metis Andromeda (1088). **Repos:** `GOATNetwork/GOAT-Hackathon-2026`, `agentkit`,
`x402`, `julies-claw/goat-agent-demo`. **Resources:** $3 gas + stablecoins (forms),
ClawUp 2-mo free.

**Chain decision:** build on **Metis Sepolia now** (live, zero setup) → migrate to
**GOAT** (config + redeploy) once gas + merchant ID land. Final identity registers on
GOAT mainnet (the submission gate). Story: "runs on GOAT, also Metis" (multi-chain).

---

## 4. The UX — the Sage ecosystem app (the differentiator)

**Direction (locked):** premium, calm, light, white — Apple / Stripe / Linear /
Mercury / Arc. A **Kast-style tabbed web app** that feels native, with a **loading
screen** boot and **one continuous living surface** from landing to every tab. Money
+ agents need trust: a chat feels casual; a premium app feels like *control*. Mental
model: **Mercury / Ramp for AI workers.** Not a chatbot, not a dashboard, not Telegram.

**Design tokens (reuse `/hire`):** bg `#fbfbf9` · ink `#1a1d21` · **indigo `#4f46e5`**
(action/proof) · **green `#15803d`** (settled/verified) · **red `#dc2626`**
(blocked/revoked). Strict color discipline. Inter (UI) + JetBrains Mono (amounts,
addresses). Soft shadows, whitespace, 14–16px radii, lucide icons. No gradients-as-
decoration, no glassmorphism.

**The tabs (minimal, ecosystem — each references the others):**
- **① Agents** *(default)* — your Deputy cards: name, mission, status pill, **live
  budget ring** (remaining/ceiling), last action. "+ New Deputy". Tap → detail (live
  work journal + payout history + ERC-8004 identity card + policy summary + Revoke).
- **② Wallet** — balance hero (funded stipend + per-Deputy vaults), Fund/Withdraw,
  full on-chain transaction history (each settled/blocked + explorer link), rings drain live.
- **③ Policies** — per-Deputy rules as toggle cards: budget ceiling · per-payout cap ·
  velocity cap · approved recipients · condition type · schedule · kill switch. The UI
  mirrors what the contract enforces (caps lowerable-only, allowlist adds timelocked,
  revoke terminal) — the restriction *is* the enforcement story. The "confirm policy once" moment.
- **④ Proof** — the verifiable trail: every decision + settlement as a receipt; every
  allowed/blocked event with its exact failed-check reason; a shareable per-payout
  **proof page** (= ClawUp/GEO content); and the **"Try to break it"** panel (real on-chain).

**Language:** human on the main surface (Agent · Reward · Payout · Vault · Limit ·
Unlock · Proof · Pause · Revoke); crypto truth (tx hashes, explorer, ERC-8004,
settlement) proudly in the Proof layer where this room wants it.

---

## 5. Business model (vault-as-stipend)
- **Free trial:** one sponsored/limited Deputy — watch real payouts land before paying.
- **Builder plan:** monthly membership **+** a user-funded **Deputy stipend** (they fund the vault).
- **Usage = the vault is the billing rail:** every payout auto-deducts a small operator fee.
  Stop funding → the Deputy physically stops.
- Frame as *funding a worker's stipend*, not a SaaS subscription.

---

## 6. v1 hero condition (the one build-prep decision)
Recommended v1 hero: **explicit poster approval** — the human poster's "Accept" *is*
the source of truth (fastest to a working loop, 100% honest; the AI still monitors,
matches, dedupes, computes payout, enforces, recurs). Add **on-chain proof** (the
winning action is itself an on-chain event the Deputy reads) as the autonomy showcase
for Demo Day. The unambiguously-real leg is the **USDC payout** (already shipped).

---

## 7. The 8-week plan

| Week | Focus | Work |
|---|---|---|
| **1** | Shell + deploy + rails | **Kast tab shell** (Agents/Wallet/Policies/Proof) + loading screen on the live vault. Deploy public. Fill gas/stablecoin forms, apply x402 merchant ID, clone GOAT repos. Pick hero condition. |
| **2** | Payout loop | Condition verification (explicit approval) → release USDC. "Confirm policy once → autonomous payout" UX. |
| **3** | Recurring mandates | Standing bounties / scheduled payouts, no re-confirmation inside policy (the "tomorrow"). |
| **4** | Proof artifacts | Shareable public proof page per payout (ClawUp/GEO assets). |
| **5** | ERC-8004 | Register Deputy on GOAT mainnet; work history = real settled payouts. Migrate vault to GOAT. |
| **6** | Real users | Onboard 5 cohort/community teams to run their payouts. Offer: "free vault, set rules once, the Deputy verifies + pays." |
| **7** | x402 + monetization | Real `goatx402-sdk-server` for paid verification; vault-as-stipend + operator fee. |
| **8** | Demo Day | Lock script, polish the ecosystem UX end to end. |

---

## 8. Demo Day script (the room includes the Metis cofounder — pre-sold the pain)
**Open:** "Day one, we watched an agent make a real purchase — but it got stuck
asking for permission again and again. That's not autonomy, that's babysitting. Sage
fixes it: confirm the policy once, the agent works inside it, and it physically
cannot go rogue."
**Live:** create a Payout Deputy → set policy once (budget · per-payout cap · approved
recipient · condition · kill switch) → a bounty condition is met (real evidence) → the
Deputy releases the **exact USDC** to the **exact approved wallet**, no re-confirmation
→ **the gauntlet:** overpay → blocked · unapproved wallet → blocked · revoke → dead
(all on-chain) → show ERC-8004 identity + real payout history → show real cohort users
→ *(optional 20s)* "it can also buy things" (Snaplii).
**Close:** "The future isn't agents asking permission every ten seconds. It's agents
with enforceable boundaries — and you watched our own founder hit this wall on day one.
This is the agent that doesn't."

---

## 9. NOT building (guardrails)
❌ lead-gen as the product · ❌ generic "Ops Deputy" (too wide) · ❌ trading · ❌ agent
marketplace (Agora) / agent-to-agent settlement (Finality Labs) · ❌ invoicing (PayMate)
/ OSS-PR (Triage) · ❌ Telegram-first chatbot · ❌ gift-card *product* · ❌ subjective AI
quality-grading on the critical path · ❌ fake/simulated spending (a run only counts if
real money leaves the vault to a real party).

---

## 10. Bottom line
**Locked:** Sage (platform) · Deputy (worker) · Policy Vault (leash) · premium tabbed
web ecosystem (UX) · vault-as-stipend (model). **Flagship: Payout Deputy** — bounty &
reward payouts, verifiable conditions + hard enforcement, real USDC. The next thousand
changes belong **inside the build.** Go be the first champion.
