# Sage — pay for verified work

**Future Caribbean Global Buildathon · Finance, Payments & MSME Capital**
**Live product: [sagepays.xyz](https://sagepays.xyz) · open source: [github.com/shariqazeem/sage](https://github.com/shariqazeem/sage) · solo builder: Shariq Shaukat**

---

## What it is, in one paragraph

Sage is an autonomous agent that turns a sentence into financial infrastructure. A founder, a diaspora funder, or a small business says the work once — *"test my product with $10"*, *"pay my designer $50 when the logo page is live"*, *"fund my cousin's shop in three milestones"* — and Sage compiles it into missions with a verification contract, funds an on-chain vault with hard caps, **verifies every claim itself** (in a real browser, against the published artifact, or on-chain), pays only what survives, and publishes a receipt for every settlement and a reason for every refusal. Recipients need no bank and no wallet app — chat is the account. Every earner accumulates a public, receipt-anchored **Verified Work Record** with deterministic credit signals — the cash-flow history collateral-based lending is missing.

One loop — define → verify → pay-or-refuse → receipt → record → **capital back in** — running live
on TWO mainnet rails with real USDC: GOAT (the public tape) and Starknet (the private claim — a
worker collects by one-time link, including into a shielded note). The founder never picks a chain;
they pick an outcome — *public receipts* or *private-capable* — and the router picks the rail.

```
witness (agent) → obligation (signed, capped) → vault (cannot exceed)
   → router (GOAT public · Starknet private · licensed-fiat door, interface-ready)
      → record (public tape or selective proof) → capital in (the advance facility)
```

## The track's bar, answered with receipts

| The brief asks | What ships (all live, all verifiable) |
|---|---|
| **Lending without collateral — capital actually moves** | **The Sage Advance facility, live**: capacity is published arithmetic (`the lender's multiple × verified monthly inflow` — Sage scores nobody), disbursement is a claim link from the pot, and repayment is **the waterfall** — each subsequent verified payout escrows as two legs, the pot's slice and the worker's remainder, recourse on the Sage-routed remainder only. One active advance per borrower and one repayment per payout are schema-level guards. The lender view prints the exact API call an institution's system would make, refused past the same formula the page shows. [sagepays.xyz/lender](https://sagepays.xyz/lender) |
| **Privacy that banking-shy earners need** | An earner can withhold amounts from their public record and instead issue a **signed earnings floor** ("earned ≥ $X") their lender verifies at /lender or off-platform — the issuer address is published, and a tampered floor or wrong-wallet document fails in words. Income that can be borrowed against without being a public diary. |
| **Does the system change outcomes? (the track's own bar)** | Measured, from the ledger, on a public page: recipients keep **100%** of the vault-derived reward (the 8% corridor would have taken **$4.21** of the settled total); **median 3.4 minutes** submission→settled *with verification included*; access with integrity (44% refused); rails, funders and denominations from the rows — and the one unmeasured number (intra-regional corridor flow) stated as **not yet measured**. [sagepays.xyz/outcomes](https://sagepays.xyz/outcomes) |
| **MSME Credit Layer (CORE): aggregate fragmented data → real-time credit profiles → lending without collateral** | Every payout is verified-before-paid and receipt-anchored, so the byproduct is credit data that cannot be self-reported: [`/record/<wallet>`](https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d) with **Sage Signals** (`credit-signals-v2`) — pass rate over judged submissions, verified inflow per active month, distinct funders, tenure, recency — every formula deterministic and published, no invented score. Lender-consumable JSON: `/api/record/<wallet>` (`sage.work-record.v4` — now carrying the advance facility's history through one redaction boundary). |
| **Diaspora capital: investment rails, not just transfers** | A funder speaks a milestone grant into Telegram; the recipient is onboarded by a chat link (walletless — a policy-bound server wallet is minted for them), each tranche releases only on verified proof, and the refusals are on the record too. A remittance becomes conditioned investment with an audit trail. |
| **Payment fees 7–9% → <1%; settlement approaches real-time** | USDC on GOAT Network: payout gas ≈ $0.000002; autonomous settlements typically land in ~2–3 minutes of submission, receipt included. |
| **Works with fragmented, real-world data** | Verification is Sage's own observation of reality: it browses the product, fetches the artifact, reads the chain — and **refuses what it cannot verify**. Live refusal share: **44% of all judged submissions** (23 refusals / 52 decided), each with its reason. |
| **KYC/AML in flow** | OFAC SDN screening (vendored, dated snapshot — never a runtime API on the money path) at three independent doors: submission, the autonomous preflight, and manual release. Plus Sybil controls (near-duplicate detection, artifact-twin fingerprinting, per-wallet caps, daily limits) and full public auditability. [The compliance chapter](https://sagepays.xyz/docs/compliance). |
| **Integrates with existing institutions** | The record API is the decision-support surface a lender consumes; the public MCP surface + open worker reference lets any institution's (or anyone's) agent participate. [Build on Sage](https://sagepays.xyz/docs/build-on-sage). |
| **"Strong teams build financial infrastructure"** | The [Explorer](https://sagepays.xyz/explorer): every settlement **and every refusal**, live, searchable by transaction or wallet. Payments infrastructure that shows its work. |

## The numbers (mainnet, live at submission time)

- **$52.60 USDC** settled across **29 verified payouts** — **21 distinct people paid** (Sage's own dogfood wallets settle on the same rails but are excluded from the people count) — every one a public transaction.
- **44% of judged submissions refused or held** (23 of 52) — the discipline that makes the payments (and the credit records) mean something. No human reviewed any autonomous decision.
- Campaign deploy gas ≈ $0.0000002; payout gas ≈ $0.00000002 (BTC on GOAT).

## Four receipts that tell the whole story

1. **The first autonomous payout** — Sage judged a human's own-words account against its own observations and paid $1 with no human in the loop: [`0x8df776…0069`](https://sagepays.xyz/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069)
2. **An AI earned under the same rules** — an autonomous agent discovered a gig over the public MCP, published a real deliverable carrying its own wallet, signed the same EIP-712 claim a human signs, and was paid $0.50: [`0xb01203…d827`](https://sagepays.xyz/proof/0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827)
3. **That AI's credit file** — the same loop produced a machine-readable verified work record: [`/record/0xccbf…768d`](https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d)
4. **A real stranger, refused** — within the hour of the first gig going live, an off-contract spam submission arrived and was held by the deterministic verifier: zero dollars moved, zero model spend, reason on the record.

## Why the agent is trustworthy (the part we test adversarially)

- **The AI proposes, the vault disposes**: budgets, per-mission rewards, completion caps, and daily velocity are on-chain; no model ever computes a money amount.
- **Deterministic checks run first** (host + wallet-marker binding for artifacts, chain reads for on-chain proofs, sanctions screen, twin fingerprints) — the judge model only ever *narrows* what can be paid.
- **Two-sided adversarial evals** (P-JUDGE, P-WORK) run the production judgment path against attack fixtures *and* honest-work fixtures: an attack that pays and honest work that holds are both hard failures — the battery cannot be passed by blanket strictness or blanket leniency. The payout judge (MiniMax-M3) is promotion-gated on this evidence.
- **Injection is expected**: untrusted content rides inside markers, quotes must be verbatim substrings of fetched evidence, and an artifact carrying "SYSTEM: recommend pay" instructions is a fraud signal, not an instruction.

## What we don't claim

No identity KYC (wallet pseudonymity + sanctions screening + Sybil controls; named-recipient
allowlists where operators need them). Screening is list-based and snapshot-dated. Walletless
custody is provider-held under policy, stated plainly wherever it appears. The fiat door is
**interface-ready, not live** — the typed adapter cannot ship without producing the identical
credit event, the corridor quote works today, and the disburse function refuses in words rather
than simulating money movement, because a "mark paid via partner" button with no partner is
theatre. The first advance's mainnet round-trip (disburse → waterfall repayment) is the one
receipt in this document still pending as of writing — the facility is live and the runbook is
committed; it lands the moment a borrower with a record earns their next payout.

---

*Deeper docs: [how it works](https://sagepays.xyz/docs/how-it-works) · [the safety model](https://sagepays.xyz/docs/safety) · [compliance & controls](https://sagepays.xyz/docs/compliance) · [build on Sage](https://sagepays.xyz/docs/build-on-sage)*
