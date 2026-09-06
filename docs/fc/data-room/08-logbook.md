# Sage — build logbook, 27 August to 5 September 2026

Every entry maps to commits in the public repository (https://github.com/shariqazeem/sage) and to measured runs. Numbers are the ledger's.

## 27 August — the credit layer, and payouts that survive contact with reality
Built the credit layer the track asks for: Sage Signals, a deterministic, published, versioned formula over receipt-anchored payouts — verified inflow, distinct payers, months active, tenure, verification pass rate — exposed at `GET /api/record/<wallet>`. No model computes creditworthiness; a lender feeds these into their own underwriting. Closed the money-out gap for people with no crypto: gasless cash-out from chat, with the token's EIP-712 domain recomputed before any signature. OFAC SDN screening on every payout path.

## 28 August — the second rail begins
Cairo vault designed and declared: the vault looks the reward up from the mission (the amount is not an argument), enforces caps and per-wallet replay, and answers a refused payout with a code rather than reverting. Telegram and web reach parity on the founder loop.

## 29 August — two rails, one founder
A founder now signs in with either an Ethereum or a Starknet wallet and is the same person by one ownership check. The private-capable launch end to end, one signature, verified against Starknet mainnet before going live. Two defects between a private campaign and its first payout fixed. Routing battery back to 32/32. 70 commits.

## 30 August — who earned a payout, and where it goes
The Cairo vault separates the earner from the destination: a payout settles into an escrow the worker opens with a one-time claim link, delivered in their own panel only. Split-payout class registered; capability decided from the class. Founders can release held work from the console. Proved by simulation that the vault would release a real reward and refuse a mission it does not have. 64 commits.

## 31 August — the first autonomous private payout
A stranger submitted, Sage judged, the vault released into escrow, the claim link reached the worker — no human in the loop. Privacy page written; STRK20 submission made legible, one overclaim removed. Battery baseline all green on MiniMax; P-GEN 13/13; a regression of my own caught by P-DIRECT and fixed the same hour. 36 commits.

## 1 September — one ledger for every number
Every public total derives from one settled ledger; a Starknet settlement reaches it whoever initiated it. Future Caribbean data room assembled as a diligence index; STRK20 manifest served at the demo URL listing both contracts. Launch pre-flight: both rails green, the sweep watcher alive, gas for roughly 1,500 settlements. Ledger at 29 payouts to 21 people. 49 commits.

## 2 September — the loop rehearsed end to end
The whole Future Caribbean loop rehearsed without money — grant composed, milestones verified, waterfall traced — so what remains is funding, not building. Linkable lender view; one refusal-share derivation for every surface; deploys build beside the live server and swap. Judge Q&A written. P-GEN 13/13 with the mission prompt frozen. 95 commits.

## 3 September — the paymaster, and the ledger drawn
No plans, no seats: Sage earns on settlement, decides on every door, and open work settles after a finalization window. The treasury: fund once, the agent deploys and funds each campaign inside a per-campaign cap. The settling lane and the public wallet graph drawn as living objects from chain reads. One Starknet gig paid ten published write-ups in a single day, each verified and settled in minutes. Compliance statement under 500 words; demo videos served from the site. 61 commits.

## 4 September — the standing mandate
Fund once and Sage decides what work to buy next — where, never how much; every move recorded with its reason before money moves and vetoable for a window. Design pass across nine surfaces: let the picture make the argument. Money-lane fixes from the live battery: a price written in words is still a price; deployments expressible on the web form. Decision: Sage for teams — invite-only work that never touches the public board. 57 commits.

## 5 September — one person, one slot
Public work asks for a one-time World ID proof at the mission; every cap counts the person across all their wallets. Armed on production. Email and wallet are one account. The operator proposes its first move at $0, with its reason and price. Obligations priced in fourteen currencies at a stamped rate, benchmarked against World Bank readings. Workers sign in by email and withdraw gaslessly from inside Sage; walletless founders are never asked for gas. Truth pass on the package. Batteries on the shipping build: P-GEN 13/13, P-DIRECT green, P-OPERATOR 4/4, P-ROUTE 29/32, 4,420 tests. Ledger: $63.60 settled, 39 payouts, 26 refusals, 24 people. 66 commits.

## 6 September — the first Caribbean obligation, and the first advance
Real money, end to end, on the private rail. A J$1,600 grant to a market seller, split into two milestones of J$800 (→ $5.05 at a stamped rate of 158.27): milestone one submitted at 16:50:43 UTC, verified 24 seconds later, **paid at 16:51:41 — 58 seconds from submit to settled** (`0x72838f…83f8`). Twelve minutes after that payment landed, the recipient's own record priced a working-capital advance from verified inflow and disbursed **$1.85 in one click, no application and no collateral** (`adv-1997e6ea-454`). Milestone two verified 7/7 at 95%, paid at 17:11:25 (`0x2337af…bb54`), and the waterfall took the $1.85 out of it: **the advance was repaid in full eight minutes after it was drawn**, outstanding zero. The pot later collected its own repayment leg back (`0x604cf9…ffef0`), closing the loop physically: pot → borrower escrow → payout → repayment escrow → pot. Stated plainly: this was a rehearsal in which our own second wallet stood in for the seller. The grant, the vault, the money, the receipts and the advance are all real and on the public ledger; the person was us.

Two defects surfaced by running it rather than reading it. Milestone two was **held** by the copied-artifact watch at a 72% match — against her own milestone-one page. A person's work is not a copy of itself; both cross-wallet watches now read other people's work only, with a structural test over both readers. And a payout's local amount rendered blank on a split grant, because the milestone carried no per-milestone local figure; the denomination now derives each milestone's share at the stamped rate. Also shipped: the founder's sentence fills the money deterministically in the composer, milestone grants release in order, and Privy policy names fit the 50-character cap that had been killing every website treasury at creation.

## 7 September — collected privately, and two defects on one sentence
Both milestone payouts were **collected into shielded notes through the STRK20 pool** (`0x5cb6e4…1593`, `0x359574…71f3`): the secret is consumed inside the call and the recipient's address appears nowhere, so the payment is auditable and the destination is not. The manifest now carries twelve transactions.

Then one pasted sentence exposed two defects in the composer, both fixed and both verified against the live model rather than a stub. "Pay a market seller J$1,600 **in two milestones**: first the catalogue page, then the first customer review" compiled to **one deliverable paying the whole J$1,600**. The count was already read deterministically from the founder's own words — the draft simply never asked for it, and the corrective round only ever fired on a schema miss, so a plan that paid the whole grant for half the work was structurally invisible. The stated count is now handed to the model and checked against its answer, with one corrective round and a founder-facing note if it still will not comply. Holding the model to two milestones then exposed the second defect: a flat 2,200-token answer budget cut the JSON mid-object, both rounds burned, and the founder was told their sentence "didn't fit the brief shape". The budget now scales with the milestones asked for. A live battery (`DRAFT_LIVE=1`) runs the real model against two-, three- and no-count sentences; all three pass.

Smaller, same day: the collection page re-reads the link on every fragment change — a second claim link pasted into the tab that had just collected the first showed "Already collected" over $3.20 that was waiting. Nothing the app shell renders now prints, after the Home/Agent pill printed over a verified income statement's title. And a Starknet wallet is read under every spelling it is written in, after one record displayed "3 completions · of 0 judged".
