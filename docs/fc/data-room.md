# Sage — data room (Future Caribbean, Finance/Payments/MSME track)

> The index a diligence reader opens first. Every claim links to the live page or the
> on-chain transaction that proves it; this file restates as little as possible, so it
> cannot drift from the sources it points at. Assembled 2026-09-01; submission Sat 6 Sep.

## The system, running

| Door          | URL                                                                                                            | What you'll see                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Product       | https://sagepays.xyz                                                                                           | The launch flow: one intent → funded vault → autonomous verified payouts                                    |
| Marketplace   | https://sagepays.xyz/marketplace                                                                               | Open paid work; empties when every funded slot fills — that is the system working                           |
| Explorer      | https://sagepays.xyz/explorer                                                                                  | **Every settlement and every refusal**, each anchored to a transaction                                      |
| Outcomes      | https://sagepays.xyz/outcomes                                                                                  | The track's own bar (cost, speed, access, flow) computed LIVE from the settlement ledger — nothing typed in |
| Work record   | [`/record/<wallet>`](https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d)                   | A worker's verified cash-flow history + published credit signals (`credit-signals-v2`), CSV + JSON          |
| Lender view   | https://sagepays.xyz/lender                                                                                    | Underwriting on verified inflow: published arithmetic, signed floor attestations, the advance facility      |
| Proof receipt | [`/proof/<tx>`](https://sagepays.xyz/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069) | One payout, fully cited: evidence → decision → on-chain settlement                                          |

## The four claims, each with its receipt

1. **An AI pays humans real money inside limits it cannot exceed.** First autonomous
   mainnet payout: [`0x8df776…0069`](https://sagepays.xyz/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069) — judged from the tester's own words, settled by the vault.
2. **An AI earned under the same rules it pays under.** An agent found a gig over the public
   MCP, published a wallet-marked deliverable, signed the same claim a human signs, was paid:
   [`0xb01203…d827`](https://sagepays.xyz/proof/0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827)
3. **The byproduct is credit data that cannot be self-reported.** That agent's own record:
   [`/record/0xccbf…768d`](https://sagepays.xyz/record/0xccbfb9bba88f282282a29aa1338175cc835e768d) — the same page every human worker gets.
4. **A second, private-capable rail settles the same bargain.** Starknet payouts (3 live,
   listed on the explorer); vault + claims contracts below.

## Contracts

- **EVM (GOAT mainnet, chainId 2345)** — `CampaignVault` V2 per campaign, deployed from the
  factory; USDC `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`. The vault derives the exact
  reward, enforces caps + replay protection; the settlement event is the source of truth.
  Technical spec: [`docs/CAMPAIGN_VAULT_V2.md`](../CAMPAIGN_VAULT_V2.md).
- **Starknet mainnet** — `SageVault` (Cairo; refusals answer with a CODE on-chain, so the
  reason lands where the recipient can read it; the privacy class declared 2 Sep keys its
  events by `intent_hash`, naming nobody) + `SageClaims` (escrow pool behind bearer
  claim links; 35 tests, eleven money guards each verified by mutation). Addresses, class
  hashes and declare/deploy txs: [README, "Live on Starknet mainnet"](../../README.md) —
  kept in one place deliberately.
- **Qualifying manifest**: [`strk20.json`](../../strk20.json) (contract + transactions).

## Money, as of 2026-09-01

Numbers below move as campaigns run — the LIVE derivations are the pages, all computed from
one settlement ledger (`src/lib/campaigns/settled-ledger.ts`) with **named scopes**:

- **Every settlement** (explorer, outcomes-flow): **$52.60 across 29 mainnet payouts** — GOAT 26, Starknet 3.
- **Paid to testers** (marketplace, launch — Sage's own dogfood wallets excluded): **$50.60 across 26 payouts to 21 people**.
- **Refusals on record: 23 (43%)** — access without integrity is a faucet; the refusal ledger is
  what makes the record under it underwritable.
- **0% taken from recipients** on every payout to date; the 8% corridor benchmark comparison is
  computed on /outcomes.
- Obligations denominate in **14 currencies** (Caribbean first: JMD, TTD, XCD, BBD, HTG, DOP,
  GYD, BSD, BZD, SRD + CAD/GBP/EUR/USD), converted once at a stamped, source-attributed rate;
  settlement is always the USD stablecoin.

## The credit layer (the track's CORE ask)

- **Verified work record** per wallet: deterministic published formulas over receipt-anchored
  rows — pass rate, verified inflow/month, distinct funders, tenure, recency. **No invented
  score; Sage computes no creditworthiness verdict.** JSON: `/api/record/<wallet>`
  (`sage.work-record.v4`, one redaction boundary).
- **Floor attestation**: the earner signs a lifetime-floor statement over their withheld
  record with their own wallet; the lender paste-verifies it on /lender. Oracle-safe by
  design (no live pre-submission feedback anywhere — the NO-ORACLE policy).
- **Sage Advance**: working capital against verified inflow. Capacity is published
  arithmetic (lender's multiple × monthly verified inflow), disbursed pot → bearer claim
  link, repaid by a deterministic **waterfall on witnessed inflow** — the settlement splits
  into repayment leg + worker remainder in one escrow call, no new Cairo. One active advance
  per borrower, one repayment per payout (both DB-enforced). Status: **facility live; first
  mainnet advance pending a funded campaign** — stated on /outcomes in those words.

## Sage for teams (shipped 2 Sep) — the backbone claim made concrete

An employer or MSME hands gigs and milestone grants to its **own** staff, contractors or
grantees: "Only people I invite" keeps the campaign off every public board, the founder
shares its door, and the work is verified and paid exactly the same way — on the
private-capable rail if they choose. Payroll for verified deliverables, no HR system, no
bank account on the recipient's side, and every payout still lands on the worker's
verified record. Live at https://sagepays.xyz/launch?do=pay.

## Why trust the agent (tested, not asserted)

- **The LLM proposes, the vault disposes** — no model ever computes a money amount.
- Frozen safety layers (judgment rubric, injection detector, autopilot AND-gate, mandate
  policy, vault ABIs, settlement flows) guarded by a red-team suite plus live batteries:
  P-GEN (mission quality), P-DIRECT (money lanes — certified 1 Sep: two conclusive rounds,
  0 budget violations, 0 amount drift), P-JUDGE (payout judge promotion: zero wrong-autopay),
  P-WORK (gig judging: 21 attacks, 0 leaks), P-ROUTE (tool routing incl. the recipient
  journey), P-VERIFY (deterministic verification contracts), Starknet payout dry-run
  (simulates the real `request_payout` against the live vault, with a control row).
- Sybil controls that have fired in production: near-duplicate detection, funding-graph
  wallet-rotation detection (a real 4-wallet cluster caught on-chain), per-wallet caps,
  daily limits. Forensics: [`sybil-cluster-forensics.md`](./sybil-cluster-forensics.md).
- Compliance posture: [`compliance-statement.md`](./compliance-statement.md).

## Honesty ledger — what we do NOT claim

[`what-is-left.md`](./what-is-left.md) is the standing document. Highlights: the gig/artifact
lane has run one production campaign ever (hardened by battery, not by volume); the first
mainnet advance has not yet run (facility live, waiting on a funded campaign); no BBD/JMD
denominated obligation has settled yet (the rail is live, the reading will exist when the
flow does); fiat settlement is an interface with an honest refusal, not a live adapter.

## Repository map (for the technical reader)

- Architecture: [`docs/architecture`](https://sagepays.xyz/docs/architecture) (live) ·
  settlement: [`/docs/settlement`](https://sagepays.xyz/docs/settlement) · judging:
  [`/docs/judging`](https://sagepays.xyz/docs/judging) · safety: [`/docs/safety`](https://sagepays.xyz/docs/safety)
- The film: [`film-script.md`](./film-script.md) · video specs: [`../posts/VIDEO-SPECS.md`](../posts/VIDEO-SPECS.md)
- This submission's overview: [`submission-overview.md`](./submission-overview.md)
