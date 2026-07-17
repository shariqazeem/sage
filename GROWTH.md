# Sage — seed users & growth

## The market

Sage sits between two under-served sides of a real, recurring pain:

- **Founders who need real product testing** but can't afford an agency, don't trust a
  stranger with their keys or their credit card, and get nothing verifiable back from a bug
  bounty or a "please try my app" tweet.
- **People who want to earn real money for small, verifiable tasks** — the "get paid to test
  products" wedge — but distrust unpaid feedback forms and points-for-nothing programs.

Sage closes the loop between them with **bounded autonomy over money**: the founder funds a
capped on-chain vault once; Sage designs the missions, judges the evidence, and pays real
USDC — and every payout is a public, verifiable receipt.

## Seed users (the ICP for each side)

**Supply — the first testers.** Crypto-curious people who already have (or will accept a
walletless) wallet, live on Telegram and in builder communities, and want small, fast,
*real* USDC for concrete tasks. They are reachable in bulk (a builder group, a testing
community) and they convert because the payout is real and provable — not points, not
"maybe later." Their share-worthy artifact is the `/proof/<tx>` page: *"an AI agent paid me
$0.40 for testing a product — here's the on-chain proof."*

**Demand — the first founders.** Early crypto-native builders shipping a product who need
signal on whether the thing actually works for real users, and who are comfortable with a
wallet or Telegram. They convert because Sage removes the two blockers of paid testing:
they never hand over keys (the vault caps everything on-chain) and they get *verified*
evidence back, not noise. The walletless Telegram path lowers the bar to "message a bot,
name your product and a budget."

We seed **supply-first around a single real campaign**: one funded campaign with real
payouts is itself the acquisition engine for both sides.

## Growth loops

1. **Paid-tester loop.** A tester gets paid → shares their proof receipt → new testers
   arrive at the board → they get paid → they share. The receipt is the referral.
2. **Founder loop.** A founder sees real receipts + verified feedback → launches more and
   bigger campaigns and invites peer founders who watched it work.
3. **Proof loop.** Every payout is a public artifact (`/proof/<tx>`, `/agents/sage`) — a
   durable, indexable, screenshottable surface that compounds as discovery.

## Metrics

**North-star metric: USDC settled to verified testers.** It is the one number that can't be
faked — real money moved on-chain for real, verified work. Everything else is an input to it.

**Input / activation**
- Campaigns launched · missions designed · submissions received
- Unique testers paid · repeat testers · founders with ≥2 campaigns
- **Autopay rate** — share of verified submissions settled with no human in the loop (autonomy)
- **Hold→release rate** — held work a founder later releases (moderation working, calibration)
- Time-to-first-payout (submission → on-chain settle)

**Trust / quality**
- Blocked off-policy spends and injection attempts caught (integrity)
- Proof-page views / shares (the loop turning)
- False-hold rate on clean work (judge calibration — an explicit Stage-2 eval target)

**Guardrails (invariants, not growth levers)**
- Zero over-budget or off-policy settlements (the vault's whole promise)
- Zero fabricated activity-feed events (every line maps to a real row)
- `$ blocked / $ settled` stays healthy — the agent is being *bounded*, not rubber-stamping

## Why the loop is defensible

The moat isn't the model — it's the **accumulating, verifiable track record**: an ERC-8004
identity whose reputation is derived from real on-chain settlements, plus a growing corpus of
public proof pages. A competitor can copy the UI; they can't copy a year of receipts that a
stranger can re-check on-chain. Trust, here, is a compounding asset.

## Stage 2 (where growth compounds)

Evidence beyond a public URL (screenshots, behind-auth flows), walletless-web parity so a
non-crypto founder can launch in a browser, a richer pay-side judgment eval set, and the full
"run everything from chat" surface. Each widens the addressable ICP on top of a proven core.
