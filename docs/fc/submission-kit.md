# Future Caribbean — submission kit (paste-ready, refreshed 5 Sep 2026)

Every field the form asks for, in the order it asks. Refresh the three LIVE numbers from
https://sagepays.xyz/outcomes right before submitting.

**Project name.** Sage — an AI agent that moves money on verified work.

**One-line.** Autonomous payments infrastructure for the Caribbean's MSMEs: an AI agent takes a budget
and an outcome, verifies the work people deliver, pays them in USDC from a vault it cannot exceed,
and turns every payout into a credit record that unlocks working capital without collateral.

**Track.** Finance, Payments & MSME Capital Systems (core: the MSME credit layer).

**Links.**
- Live product: https://sagepays.xyz (one door: https://sagepays.xyz/start)
- Source (MIT): https://github.com/shariqazeem/sage
- Overview: https://github.com/shariqazeem/sage/blob/main/docs/fc/submission-overview.md
- Architecture + data sources: https://github.com/shariqazeem/sage/blob/main/docs/fc/technical-documentation.md
- Compliance statement (450 words): https://github.com/shariqazeem/sage/blob/main/docs/fc/compliance-statement.md
- Video (64 s): https://sagepays.xyz/videos/07-fc-demo.mp4
- Live ledger: https://sagepays.xyz/explorer · Outcomes against the track's bar: https://sagepays.xyz/outcomes
- Lender view: https://sagepays.xyz/lender · A record: https://sagepays.xyz/record/0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048
- Strategy: https://github.com/shariqazeem/sage/blob/main/docs/strategy/autonomous-paymaster.md

**What it does (the paragraph).** Copy "What it is, in one paragraph" from the overview.

**Impact and scalability.** Copy the section of that name from the overview; refresh the numbers
(payouts, wallets, people after clusters collapse, refusals).

**Data sources.** Copy the "Data sources" section from the technical documentation.

**Evidence of real use.** 39 mainnet payouts across two rails (26 GOAT, 13 Starknet), $63.60 settled,
26 refusals with published reasons. Those payouts reached **32 wallets but 24 people** — nine wallet
links are recorded on-chain, and we publish the collapsed number rather than the wallet count,
including on our own public board. Median time from a submission to USDC in hand: **under three minutes** (computed live on `/outcomes`).
Every figure is checkable at `/explorer`, and the cluster that forced the collapse is drawn at
`/graph/gig-1c3e_FjffE`.

**What is new since the last submission.** A founder now funds once and stops deciding: the agent
chooses what work to buy inside ceilings it cannot exceed, proposes each move with its reason before
money leaves, and can be vetoed or instructed in plain words. Proof of personhood is wired, and its
nullifier is what makes one person unable to become two workers.

**Team.** Shariq Shaukat (solo), with Sage's own agent doing the verifying and paying.
