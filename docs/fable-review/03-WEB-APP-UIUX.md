# 03 — Web App UI/UX

> An honest audit of the web app's design and experience: the design system(s), the founder onboarding + launch flow step-by-step, the campaign and tester surfaces, and a critical flaw list to drive a redesign. Grounded in the code as of 2026-07-16. File:line references throughout.

---

## 0. Framing: the spec's design system is dead

`CLAUDE.md` §4 mandates a **dark Bloomberg-terminal** aesthetic (deep ink `#0A0E14`, no gradients, no glassmorphism, no shadows, 2–4px radii, no emoji). **That design system is effectively dead** — it exists only in `src/app/globals.css` and is consumed *solely* by the disabled `/sage` placeholder page and some unused primitives. The real product is a **warm, premium-light, Apple/Stripe/Linear-flavored** SaaS. **Almost every §4 constraint is violated by the shipping product.** Read §4 as fiction relative to the code.

---

## 1. The design system(s) — the headline problem: there are five (really six)

There is no single design system. There are **five separate, hand-rolled, mostly-duplicated CSS systems**, four of them light, plus the dead dark one — none sharing design tokens.

| # | Scope | File | Palette | Used by |
|---|---|---|---|---|
| 1 | `:root` global | `globals.css` | **Dark** (`#0A0E14`) | Dead — only `/sage` + unused primitives. It IS the `<body>` background, so elsewhere it only shows up as bugs. |
| 2 | `.clx` | `cinematic.css` (1081 lines) | Light (`#fbfbf9`/`#1a1d21`, green/red) | Landing |
| 3 | `.lx`/`.lxo`/`.lxd` | `launch/launch.css` | Light **warm, terracotta accent `#c2410c`** | Founder launch + inspection + deploy |
| 4 | `.hire` + `.sage-app` | `hire/hire.css` + `app/app.css` (1319 lines) | Light + shadow tokens | The app, campaign console, public board, dashboard, link |
| 5 | `.spp` | `sage-proof.css` | Light | Proof pages |

Systems 2, 4, and 5 independently **re-declare almost the identical light palette** (`#fbfbf9`/`#1a1d21`/`#15803d`/`#dc2626`) under different variable names. System 3 is a warm terracotta fork. A **sixth micro-system** is shipped as a template-literal `<style>` string inside `link-client.tsx:252`.

**What IS consistent:** the **fonts.** `layout.tsx:5-15` loads Inter (`--font-inter`) + JetBrains Mono via `next/font`, referenced everywhere as `var(--font-sans)`/`var(--font-mono)`. Tabular numerals set globally. This is the one correctly-shared token.

**§4 constraints vs reality (all violated live):**
- "No gradients" → `radial-gradient` on the hero (`cinematic.css:375`).
- "No glassmorphism/blur" → `backdrop-filter: blur()` in the landing header (`cinematic.css:192`) and app top bar (`app.css:146`).
- "Border-driven, no shadows" → `hire.css` defines shadow tokens and uses ~19 box-shadows; `app.css` ~23; `cinematic.css` 12.
- "Radius 2–4px only" → across the light CSS: **999px pills ×26**, plus 8/10/11/12/14/16/18/20/30px. The 2–4px band is the exception.
- "No emoji, use lucide" → mostly lucide, but raw glyphs as icons: `✓` (`budget-bar.tsx:69`, `deploy-flow.tsx:425,643`), `×` (`mission-card.tsx:142`), `−`/`+` steppers, `→` arrows (`launch-form.tsx:183`).

**Bottom line:** the mandated spec does not describe this product. The real aesthetic is premium-light SaaS with shadows, generous radii, and (in one flow) a terracotta accent. The work is **consolidation** — one shared token set + one component library.

---

## 2. The landing page (`/`)

- **Entry** `src/app/page.tsx` — an RSC (`force-dynamic`) that reads **live on-chain vault state** (GOAT mainnet), real payout receipts, and a real "star" decision receipt, then passes them to `CinematicLanding`. Nothing is faked; empty history → honest empty states.
- **Structure:** a scroll-driven **five-act cinematic** (`.clx`):
  1. **Hero** (`act1-hero.tsx`): headline "Give an AI agent an allowance — not your keys." animates word-by-word; a live count-up of USDC "paid to real testers"; CTAs "Launch a testing campaign" / "Explore live missions"; a 3D hero render parallaxes (falls back to a styled placeholder — `public/hero-vault.png` doesn't exist).
  2. **Problem** (`act2-problem.tsx`): three "Approve?" cards slide in then collapse into "Set the limits once."
  3. **Vault** (`act3-vault.tsx`): a **real settled decision receipt** printed in on scroll, linking to `/proof/<tx>`; degrades to a six-check rail if none.
  4. **Proof** (`act4-proof.tsx`): real on-chain payout history as cascading receipt cards; honest empty state.
  5. **Close** (`act5-close.tsx`): the one dark surface + CTA + three count-up stats.
- **Genuinely cinematic:** real `IntersectionObserver` choreography, parallax, count-ups, scroll-snap, and a proper `prefers-reduced-motion` static fallback.
- **Does it match the terminal aesthetic?** No — light/paper, a blurred glassmorphic sticky header, pills, shadows. The opposite of the mandated dark terminal.

---

## 3. THE FOUNDER ONBOARDING + LAUNCH FLOW (the core)

The most important, most-built flow. It is **wallet-free until the very end** — a deliberate, good choice.

### Step 1 — Describe the launch (`/launch`, `launch-form.tsx`)
A **3-step guided wizard, one question at a time**, with progress pips:
- **Step 0:** product URL (validated) + optional public GitHub repo URL.
- **Step 1:** "What do you want to learn?" + "Who should test it?"
- **Step 2:** budget — a large mono number input, min $0.5, step $0.5, **default $5**, unit "USDC."

Enter advances; validation gates Continue. Final button "Let Sage inspect" → `POST /api/launch` → durable inspection job → `/launch/[inspectionId]`. **No wallet, no chain, no crypto jargon here** — intentional.

### Step 2 — Inspection + plan (`/launch/[inspectionId]`, `launch-results.tsx`)
- Server route seeds the client view (refresh-safe, `noindex`). Client **polls every 2s** through 5 labeled stages: Checking product → Reviewing repo → Mapping pages → Designing missions → Checking quality/budget, with a live "Found N pages · M repo files · reviewing with <model>" line.
- **Terminal states:** `needs_input` (Sage asks clarifying questions), `failed` (friendly reason), `ready`.
- **Ready state renders:**
  - **Product map** — "What Sage understood" + an honest "What Sage could not see" note.
  - **Editable mission cards** (`mission-card.tsx`): title, reward × completions × ~effort, "Why Sage created this," priority/risk tags, a `<details>` disclosure (target surface, steps, criteria, evidence, verification, sources). **Inline editing** posts to `/api/launch/<id>/revise`; the server re-validates safety + scope and rebalances the budget exactly; unsafe edits surface inline errors.
  - **Budget bar** (`budget-bar.tsx`): Total / Allocated / **Unallocated (must reach 0)** / missions·completions. **"Approve mission plan"** is disabled until `remaining === 0`.

### Step 3 — Deploy / fund (`deploy/deploy-flow.tsx`, 728 lines — the heaviest client component)
Approval swaps in `<DeployFlow/>`. **This is where the wallet finally appears.** A durable, refresh-safe state machine driven by server state (localStorage stores only the deployment id). Phases `claim → limits → execute → attach → live` (+ recovery/failed). A top Stepper: Wallet ownership → Campaign limits → Create vault → Approve budget → Fund → Activate → Live.

- **claim:** if no wallet → install-MetaMask instructions; else Connect → **network picker** ("GOAT Mainnet (real USDC)" / "Metis Sepolia (testnet)") → SIWE sign-in → an **EIP-712 "Secure plan ownership"** signature. Reads live `eth_chainId` directly to dodge a stale React chainId.
- **limits:** Total budget (fixed), Daily payout limit, Duration (default 14 days), Network, Owner, Guardian, and a **Payout mode toggle** — Autopilot (Sage pays once confidence clears 85%) vs Manual review.
- **execute:** shows Total budget, **Your balance** (colored by sufficiency), predicted vault, "**Exactly $X (never unlimited)**" approval, "**Up to 4 one-time setup signatures**," a technical-details disclosure, and a balance-shortfall warning. "Create and fund campaign" runs **create → approve → fund → activate** sequentially, each a wallet tx confirmed server-side. If the wallet supports **EIP-5792**, all steps batch into one confirmation.
- **live:** a green success card (active missions, funded amount, owner, "Sage operator: Bounded payout role," explorer link) + exits to the campaign console / public board / dashboard.
- **recovery:** if the final step fails, a reassuring "Your vault is safe — one step to finish" with a safe retry.

### Wallet + auth plumbing
- `use-wallet.ts`: a **bespoke viem EIP-1193 hook** (no wagmi/RainbowKit), MetaMask-first. **Defaults to Metis Sepolia** — stale, given the product now leads with GOAT mainnet.
- `use-siwe.ts`: SIWE-lite (nonce → `personal_sign` → verify → cookie). **Documented footgun:** the deploy wizard and SIWE must share one `useWallet` instance or they diverge ("connect wallet" on an already-connected wallet) — patched by hand in `deploy-flow.tsx` and `v2-board.tsx`.

### Where it gets confusing / breaks
- **Signature/confirmation overload:** SIWE sign-in + EIP-712 claim + up to **4 tx confirmations** = **~6 wallet interactions** to go live, unless the wallet supports EIP-5792 batching (most injected wallets don't). High drop-off risk.
- **Hard funding gate:** the founder must pre-fund the wallet with **USDC *and* native gas**; insufficient balance hard-stops with "top up and reload." No in-app on-ramp.
- **Extension-wallet requirement:** the whole flow assumes an injected browser wallet. The walletless Telegram path (doc 02) is a *separate* product surface, not integrated into the web funnel.

---

## 4. The campaign workspace + boards (post-launch, founder)

**`/campaign/[id]`** (`campaign-workspace.tsx`, `.hire .sage-app`):
- **Owner-gated:** server compares the SIWE session address to `campaign.posterWallet`; non-owners get an `OwnerGate` ("Connect the wallet that owns this campaign").
- **Console:** status pill; economics (Funded / Paid / Remaining + progress bar); a **mandate card** (Autopilot ⚡ vs Manual ✋, showing the 85% threshold); **Invite testers** (copyable `/c/<id>`); **Missions** (paid/max slots); **Tester submissions** (wallet, mission, confidence %, state chip, proof link); and a "Vault & provenance" disclosure (vault link, hashes, operator authority, latest proof).
- **Heavy inline `style={{…}}` objects** rather than classes — inconsistent spacing, no token discipline.
- **Historical bug worth noting:** the console once rendered **dark-by-omission** (no layout → `.hire` light tokens undefined → the global dark `<body>` bled through). Fixed by adding a layout that imports `hire.css`. A direct symptom of the five-systems problem.

---

## 5. The tester experience

**There is no dedicated tester route, dashboard, or login.** Testers act on the **public campaign board `/c/[slug]`**:
- **V2 path** (`v2-board.tsx`): per mission — title, objective, reward, remaining slots, target link. Flow: Connect wallet → **SIWE "Sign in to submit"** → "Submit evidence" form (**public evidence link** + free-text "What you observed") → **sign an EIP-712 evidence commitment** (no tx, no funds) → `POST /api/campaigns/<id>/submit` → the tester **watches the real pipeline** by polling every 2.5s: "Sage is reviewing…" → Verified (confidence %) / Held (reason) / Paid (→ proof) / Rejected / Blocked.
- **Flaw:** a first-time tester meets a cold public URL with no explanation of what SIWE is, why they're signing, or how they get paid beyond inline microcopy. There's **no tester profile, history, or "my earnings"** surface anywhere.

---

## 6. Dashboard, link, ecosystem, proof

- **`/dashboard`** (`dashboard-client.tsx`): returning-founder home, SIWE-gated. Unsigned → connect prompt; signed with none → "Launch your first campaign" empty state; else a metrics row + campaign cards → consoles. Leans on inline styles + duplicated local helpers.
- **`/link/[token]`** (`link-client.tsx`): the **Telegram agent-wallet pairing** page (the dead SIWE path — see doc 02 §7). Connect → SIWE → set a per-campaign cap → mint a Privy wallet → show the address to fund. Ships its **own entire CSS as a JS template string** (the sixth micro-system).
- **`EcosystemStrip`**: small **honest** capability chips (Live on <network>, ERC-8004 #id, x402, "Mainnet autopilot off") shown only when truly configured.
- **`/proof/[tx]`** (`sage-proof-page.tsx`, `.spp`): server-renders a real on-chain payout tx into a verifiable receipt with a staggered reveal + rich per-tx OpenGraph; honest "not found" fallback. This is the accountability surface and it's genuinely good.

---

## 7. Server-first architecture

Strongly server-first (matches §7 of the spec even though §4 is dead):
- **RSC pages** (`force-dynamic`) read chain/DB/session and pass serialized props to leaf client components.
- **Client leaves** own interactivity (all landing acts, launch form/results, deploy flow, workspace, board, dashboard).
- **Auth is server-side** (cookie session); the client only gathers signatures; money-affecting logic is server-verified (approve/revise/preview/confirm/attach all re-validate). Durable, refresh-safe state machines (deploy flow, inspection job) are a genuine strength.

---

## 8. HONEST FLAWS (this drives the redesign)

1. **Five/six parallel design systems, four near-identical light palettes, zero shared tokens.** The mandated dark system is dead weight. **#1 thing to fix: one token set, one component library.**
2. **Accent whiplash.** The founder funnel switches accents mid-journey: `/launch` is **terracotta**, but `/campaign`, `/dashboard`, `/c`, landing, and proof are **ink/green**. The most important flow is the odd one out.
3. **Every §4 constraint is violated live** (gradients, blur, shadows, pills + big radii, glyph icons). The spec and product have fully diverged — the doc is stale, not the code.
4. **The brand mark is drawn ~5 different ways** (ring-in-square, "S" glyph, "SAGE" wordmark, launch mark, onboarding mark). No consistent logo; headers differ per surface.
5. **Naming/identity confusion.** "Sage" and "the Deputy" are used interchangeably across metadata, landing, launch, console. A user can't tell what the thing is called.
6. **Stale Metis assumptions on a GOAT-first product.** `ConnectWallet` hardcodes "switch to Metis," `use-wallet.ts` defaults to Metis Sepolia — yet deploy leads with "GOAT Mainnet." The `OwnerGate` can tell a GOAT founder to "switch to Metis."
7. **Wallet-interaction overload** — up to ~6 signatures/confirmations to go live unless EIP-5792 batching is available (rare). Major abandonment surface.
8. **Onboarding requires an extension wallet + pre-funding (USDC + gas) with no in-app on-ramp.** The walletless Telegram alternative isn't integrated into the web funnel.
9. **The "reusable components" standard isn't met live.** The shadcn `ui/` primitives, `states/StatePanel`, and `verdict-badge` are used **only** by the dead `/sage` page. The real product hand-rolls buttons/inputs/cards/spinners separately in each CSS file — enormous duplication.
10. **Inline-style sprawl.** The console, dashboard, and board set dozens of one-off `style={{…}}` objects instead of classes — the antithesis of a token system and a nightmare to re-theme.
11. **Empty/loading/error quality is inconsistent.** Excellent where it exists (durable inspection polling with needs_input/failed states, deploy recovery, honest landing feeds), but error surfacing is ad-hoc plain text with no global toast system, and liveness is chatty 2–2.5s polling (no websockets).
12. **Legacy code mass on the critical path's doorstep.** `/app` (the V1 "Deputy" — a `TravelingRing`, hold-to-create gesture, floating tab bar — ~687 lines + ~2,700 lines of CSS) redirects to `/launch` but is still imported by the `/c`, `/campaign`, `/dashboard`, `/link` layouts, dragging much-unused CSS into every live page.
13. **Mobile is uneven.** Landing and launch are genuinely responsive; the founder console, dashboard, and tester board lean on inline grids with thin, unverified mobile polish.
14. **The two-`useWallet` divergence** is a latent footgun patched by hand in two places; any new wallet-touching component can silently reintroduce it.

**Route map:** `/` (landing) · `/launch` → `/launch/[inspectionId]` (funnel) · `/campaign/[id]` (console) · `/c/[slug]` (public/tester board) · `/dashboard` (founder home) · `/link/[token]` (Telegram pairing, dead path) · `/proof/[tx]` (receipt) · `/app` (legacy, redirects) · `/sage` (dead placeholder).

---

## 9. Questions this raises for improvement

1. **One design system.** Collapse five/six CSS systems into one token set + component library. What should the unified aesthetic be — keep the cinematic landing, or align everything to one calm premium-light system?
2. **One identity.** Resolve "Sage" vs "the Deputy" vs "sagepays" and one brand mark.
3. **Kill the wallet gauntlet.** ~6 signatures + pre-funded gas is the biggest funnel leak. Should the web app adopt the walletless (Privy) model so a founder never touches a wallet — matching the Telegram magic?
4. **Give testers a home.** No tester profile/earnings/history exists. The supply side of the marketplace has no product surface.
5. **Make verifiability felt.** `/proof` is the best, most on-brand surface. How do we make "verify every payout" the centerpiece of the whole experience rather than a link?
