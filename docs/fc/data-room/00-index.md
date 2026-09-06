# Sage — Data Room · Future Caribbean 2026 · Finance, Payments & MSME Capital

**Sage (sagepays.xyz) is an AI agent that pays people for verified work, inside on-chain limits it cannot exceed — and turns every payout into a credit record a lender can underwrite.** Built solo by Shariq Shaukat. Live on two mainnet rails with real USDC since 13 July 2026 (GOAT Network) and 30 August 2026 (Starknet).

This room is the validation layer for the TRL self-assessment. Every number below is read from the settlement ledger and links to a page or a transaction a judge can open. Nothing here is typed in.

## The evidence, strongest first

| # | Claim | Proof | Where |
|---|---|---|---|
| 1 | **An AI agent pays humans real money, autonomously, inside limits it cannot exceed** | 39 mainnet payouts · $63.60 settled · 26 refusals with the reason on record · median 2m 55s from submission to payment | `06-ledger-payouts.csv`, `07-ledger-refusals.csv`, https://sagepays.xyz/explorer |
| 2 | **First autonomous mainnet payout** — judged from a tester's own words, settled by the vault | tx `0x8df776…0069` on GOAT Network | https://sagepays.xyz/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069 · `screens/05-…png` |
| 3 | **Private payouts on Starknet** — vault released → escrowed behind a Poseidon commitment → collected through the STRK20 pool into a shielded note | 13 private payouts; receipt `0x2b03ed…49fb` draws the private leg | https://sagepays.xyz/proof/0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb · `screens/06-…png` |
| 4 | **An AI earned under the same rules it pays under** — an agent found a gig over the public MCP, published a wallet-marked deliverable, was paid | tx `0xb01203…d827` | https://sagepays.xyz/proof/0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827 |
| 5 | **The refusal ledger** — access without integrity is a faucet; 40% of judged work refused, each with a written reason | 26 rows | `07-ledger-refusals.csv` · https://sagepays.xyz/explorer |
| 6a | **The finance-track door** — every reading against the track's bar, how a payment becomes a record, the institution integration, the controls, proven vs scheduled — in a banker's language, every number live | https://sagepays.xyz/caribbean | `screens/`, this room |
| 6b | **A verified income statement a worker can hand to a bank** — printable, every line a settlement, with a SHA-256 digest of the live record | https://sagepays.xyz/record/0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3/statement | — |
| 6 | **A verified cash-flow record per worker + a lender's view** — published formulas over receipts, never a score; JSON and CSV per wallet; an advance facility repaid from the next payouts | live record and lender view | https://sagepays.xyz/record/0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3 · https://sagepays.xyz/lender?wallet=0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3 · `screens/07-…png`, `screens/08-…png` |
| 7 | **Obligations in the region's currencies** — J$, TT$, EC$, Bds$, G, RD$, G$, B$, BZ$, Sr$ + CAD/GBP/EUR/USD, converted once at a stamped, source-attributed rate, benchmarked against World Bank remittance-cost readings | live | https://sagepays.xyz/outcomes · `screens/03-…png` |
| 8 | **One person, one slot** — public work asks for a one-time World ID proof; caps count the person across every wallet the chain links | live on production since 5 Sep | https://sagepays.xyz/verify · https://sagepays.xyz/graph/gig-1c3e_FjffE · `screens/09-…png` |
| 9 | **The operator** — fund once; the agent decides what work to buy next (where, never how much), proposes with its reason before a dollar leaves, and can be vetoed | live; proposes at $0 | https://sagepays.xyz/docs/operator · `screens/10-…png` |
| 10 | **First place, OpenClaw bootcamp (August 2026)** — the same code, judged on real mainnet usage | certificate | `11-certificate/` |
| 11 | **Engineering rigour** — 4,420 automated tests; live batteries on the shipping build: P-GEN 13/13 (anchor integrity 100%), P-DIRECT money invariants zero, P-OPERATOR 4/4, P-ROUTE 29/32 with zero premature money confirmations, P-VERIFY 5/5; 1,146 commits | `02-technical-documentation.pdf` §batteries | https://github.com/shariqazeem/sage |
| 12 | **Compliance** — OFAC SDN screening on every payout path; KYC honestly disclaimed; the compliance statement under 500 words | `04-compliance-statement.pdf` | https://sagepays.xyz/docs/compliance |

## TRL self-assessment: level 8 — full feature set, small user base

| Level | What it means for Sage | Evidence |
|---|---|---|
| 5 | First real payout on mainnet to a real tester, no human in the loop | row 2 above (13 Jul / 29 Jul 2026) |
| 6 | Field pilot: founders launch campaigns; strangers do the work and are paid | 24 people paid across 36 tester payouts (`06-ledger-payouts.csv`) |
| 7 | Reliable in the real environment: autonomous payouts across two mainnet rails, refusals on record | rows 1, 3, 5 |
| **8** | **Full feature set, small user base: gigs, grants, testing, private payouts, credit records, live** | rows 6–9; `01-submission-overview.pdf`; `02-technical-documentation.pdf` |
| 9 | Paying institutions: a programme or lender funds campaigns and draws on the records | not yet — the first J$ grant and the first advance are scheduled (`05-proof-runbook.pdf`) |
| 10 | Scaling with proven traction | not claimed |

## Folder map

- `00-index.pdf` — this file
- `01-submission-overview.pdf` — the submission, team, and the rubric mapped to live pages
- `02-technical-documentation.pdf` — architecture, the two rails, the vaults, the batteries
- `03-judge-qa.pdf` — every likely question, answered with a live pointer
- `04-compliance-statement.pdf` — sanctions screening, custody, KYC, disclosures
- `05-proof-runbook.pdf` — the funded run that turns "built" rows into "proven" rows
- `06-ledger-payouts.csv` — every mainnet settlement: date, rail, campaign, amount, recipient, tx, receipt
- `07-ledger-refusals.csv` — every refusal with its reason
- `08-logbook.pdf` — the build log, 27 August to 5 September, every entry mapped to commits
- `screens/` — full-page captures of every live surface, 6 September 2026
- `videos/` — the product film and the six feature clips (real screens, real data)
- `11-certificate/` — OpenClaw bootcamp, first place
- Code: https://github.com/shariqazeem/sage (public) · Product: https://sagepays.xyz

## Contracts

- **GOAT Network (chainId 2345)** — `CampaignVault` V2 per campaign, deployed from the factory; USDC `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`. The vault derives the exact reward, enforces caps and replay protection; the settlement event is the source of truth.
- **Starknet mainnet** — `SageVault` (Cairo; a refused payout answers with a code on-chain) and `SageClaims` (escrow behind bearer claim links, integrates the STRK20 pool). Class hashes and deploy transactions are in the repository README, kept in one place deliberately.

## Numbers, read from the ledger on 6 September 2026

$63.60 settled across 39 mainnet payouts (GOAT 26, Starknet 13) · $61.60 to testers across 36 payouts to 24 people · 26 refusals on record (40% of judged work) · median 2m 55s from submission to settlement · 0% taken from recipients on every payout to date · fee to the payer: a flat $0.10 per settlement.
