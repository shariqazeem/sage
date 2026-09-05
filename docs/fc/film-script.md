# The film — "Fund it once. Sage does the rest."

**Target 4:00–4:30 (hard cap 5:00 — over is disqualified). Every frame is the live product or a real
receipt. Calm first-person voice; the receipts do the selling.** Two versions of scene 5/7 exist:
the FUNDED cut (after the proof run) and the HONEST cut (if the run has not happened — the
rehearsal move and the dry-run advance capacity are real too). Record whichever is true on the day.

The rubric is half business, half agentic excellence: autonomy, orchestration, reasoning,
human-in-the-loop, real-world impact. Each scene answers one of those on screen.

---

### 1 · Cold open — the ledger (0:00–0:20) · *real-world impact*
**Screen:** slow scroll of sagepays.xyz/explorer — settlements green, refusals red, the refusal share.
**VO:** "Every payment on this screen was decided by an AI agent. So was every refusal. No human
reviewed any of them, and every line links to an on-chain receipt. Sage is not software a team logs
into. It is an agent that moves money on verified work."

### 2 · The region's numbers (0:20–0:40) · *the problem*
**Screen:** three title cards: "7–9% — average transfer fees" · "80–90% of Caribbean businesses are
MSMEs" · "No credit file a lender can trust."
**VO:** "In the Caribbean, moving money is expensive, and the businesses that are the economy can't
borrow — not because they aren't good, but because nothing trustworthy records that they are."

### 3 · Say the work, in your own money (0:40–1:25) · *orchestration*
**Screen:** the composer (or the Telegram chat). Type the J$ grant sentence. The plan appears: two
milestones, **J$5,000 → $X @ rate**, the verification contract for each. Fund it. Campaign live.
**VO:** "You say the work once, in your own currency. Sage compiles it into milestones with a
verification contract, stamps the rate, and funds a vault with hard caps. From here it spends
without me — but it can never spend outside the vault's limits. The agent proposes; the vault
disposes."

### 4 · The door: one person, one slot (1:25–1:45) · *human-in-the-loop, by design*
**Screen:** the marketplace row "one person, one slot" → a mission board → "Continue with email"
(no wallet app: Sage keeps the wallet, the payout lands in it) → the verify card → the World ID
widget → "Verified — one slot on this work is yours."
**VO:** "Public work asks everyone to prove they are one person, once. No name, no document, no
country — about a minute. Fifty slots need fifty people. The operator who took ten of ten slots
with twelve wallets would have needed ten humans."

### 5 · Paid privately, and the refusal (1:45–2:35) · *autonomy + reasoning*
**FUNDED cut — Screen A:** the recipient's Telegram: the invite link opens, the wallet is minted, the
catalogue page is submitted, the **paid** push arrives. Cut to `/proof/<tx>`: **The private leg** —
vault released → escrowed behind `poseidon(secret)` → collected. "Who collected it is not on this
ledger."
**Screen B:** the wallet graph `/graph/gig-1c3e_FjffE` — the farm, drawn: twelve wallets, one
operator, caught by the consolidation watch after the money moved. Then a refusal on the explorer
with its reason.
**VO:** "Recipients don't need a bank or a wallet app — chat is the account. Sage verifies the
page, pays on Starknet into an escrow only the recipient can open, and publishes a receipt that
proves the money moved without saying to whom. And it refuses. Forty percent of judged work is
refused, with the reason on the record. That discipline is the product: a rail that pays
everything is a leak."
**HONEST cut:** replace Screen A with the AI-earner receipt (`/proof/0xb0120330…d827`) and the
Starknet autonomous payout (`0x2b03ed65…49fb`), and say "this loop has run on both rails; the J$
grant is scheduled."

### 6 · The credit file and the capital back in (2:35–3:25) · *real-world impact*
**Screen:** `/record/<recipient>` — Sage Signals: pass rate, verified inflow, tenure, distinct
funders. Then `/lender?wallet=…` — the facility: capacity as published arithmetic, the exact call an
institution makes. **FUNDED cut:** the advance taken from the record page → the claim link → tranche
two settling as two legs → "repaid".
**HONEST cut:** the lender view's dry-run capacity on a real record, and "the first disbursement is
pending — built, dry-run, not yet drawn."
**VO:** "Every verified payout accrues to a work record with deterministic credit signals —
published formulas over receipts, never a score. And Sage lends against it: an advance sized by the
lender's multiple on verified inflow, repaid by the next verified payouts through a waterfall.
Capital out, capital back in, from the ledger the agent wrote."

### 7 · The operator (3:25–3:55) · *autonomy*
**Screen:** `/workspace/autopilot` — "What Sage would do next": a sized, reasoned move against the
founder's product, the ring at rest, "Fund it and Sage moves." (FUNDED cut: a live proposal with the
veto ring counting down.)
**VO:** "Fund it once and stop deciding. Sage chooses what work to buy next — where, never how much;
the ceilings are yours — proposes it with its reason before a dollar leaves, and you can veto any
move. The agent picks where to spend. It can never pick how much."

### 8 · Close (3:55–4:20)
**Screen:** the landing hero → `/outcomes` — the four readings against the track's own bar.
**VO:** "Fees: a flat ten cents a settlement; recipients keep every cent. Settlement: minutes,
verification included. Credit without collateral: an advance against verified inflow. Regional
flow: obligations priced in the region's own currencies. Built solo. Live on two mainnet rails with
real USDC. sagepays.xyz."

---

## Capture checklist
- [ ] Explorer scroll · title cards · composer with the J$ plan · marketplace row + verify card +
      widget · Telegram invite/submit/paid (FUNDED) · `/proof` private leg · wallet graph · a refusal ·
      `/record` + `/lender` · advance taken/repaid (FUNDED) · `/workspace/autopilot` rehearsal or live
      proposal · landing hero · `/outcomes`.
- [ ] Refresh every on-screen number from the live pages on the day (`scripts/live-numbers.sh`).
- [ ] No fabricated figures; the HONEST cut says "scheduled" where a run has not happened.
- [ ] End card: "Thanks to GOAT Network, Metis, Starknet and the Future Caribbean partners."
