# A real Sybil cluster on our own mainnet campaign — found, measured, detected

**Date:** 2026-08-28 · **Campaign:** `launch-www-metis-io-bv31yf` (GOAT mainnet, $2 budget, one
mission × 4 slots × $0.50) · **Status:** detector shipped, cluster preserved on-chain.

## What happened

A $2 testing campaign was shown live during a Demo Day stream. Within ~40 minutes, five fresh
wallets submitted. Four were paid; one was refused. Textually the submissions looked like five
different people writing five different accounts of the same page — near-duplicate detection
scored **0.0 similarity**, and each paid account matched 6–13 anchors across 3–6 of Sage's own
private observations. The work was real.

The funding graph told a different story. Every wallet's first inbound native transfer is
immutable and public, so we asked who paid each wallet's gas:

```
0x31f1564d…8720  (external)
  └─> 0xDF70f6E8…90e3   ✗ REFUSED on this campaign (paraphrase, 0 corpus anchors)
        └─1.000000e-6 BTC→ 0x41c4F9c6…7699   ✓ paid  $0.50
              └─9.920354e-7 BTC→ 0xe37f2627…D488   ✓ paid  $0.50
                    └─9.840723e-7 BTC→ 0xE012F778…14a8   ✓ paid  $0.50
                          └─9.761077e-7 BTC→ 0x91588578…193f   ✓ paid  $0.50
```

Each transfer is **the previous balance minus gas**, forwarded down a chain, with the last three
links **108 and 88 seconds apart**. That is not five people; that is one person creating wallets in
sequence and passing the same speck of gas along. Their own wallet was refused, so they rotated —
and the four rotated wallets took **every slot of the mission**.

## What it proves (and what it does not)

- **The per-wallet payout cap is honest but insufficient.** It is enforced on-chain and it worked
  exactly as written: no wallet was paid twice. It simply cannot see that four wallets are one
  person. A cap on identity is only as strong as the identity.
- **The work was genuine.** Every paid submission passed the observation bar against Sage's own
  private corpus. The harm here is not fabricated evidence — it is **one person occupying four
  places meant for four people**. Those are different failures and deserve different language.
- **The refusal was correct, and it is what triggered the rotation.** The root wallet's account was
  a truthful *paraphrase* with zero corpus anchors; the anti-parrot bar refused it. The attacker's
  response to a working quality gate was to buy more attempts.
- **Textual defenses were blind here by construction.** Four honest, differently-worded accounts
  produce no near-duplicate signal. Wallet freshness flagged each wallet individually and could
  never see the relationship between them.

## What shipped in response

`src/lib/deputy/funding-graph.ts` — sibling detection over the funding graph, wired into the
decision path beside wallet freshness:

- **Chain shape** — this wallet's first funding came directly from another submitter on the same
  campaign (catches every link of the cluster above).
- **Sibling shape** — this wallet and another submitter share a first funder.
- **Medium severity, never blocking.** Funding someone's gas is also what an honest founder does
  for a friend or a teammate with no crypto. The payout gate holds only on HIGH severity, so this
  informs and never refuses. Fully failure-isolated: an unreadable explorer yields no signal,
  because an infrastructure blip must never become an accusation.
- **Surfaced where it changes an outcome.** `reviewSummary.cautions` now carries every med/high
  signal into the founder's confirm-before-pay moment, and the Telegram release tool is instructed
  to read them out verbatim before asking for a yes.

Tests replay the real chain with the real addresses (`funding-graph.test.ts`), so the detector
breaks loudly if it ever stops recognising the thing it was built for.

## The deeper answer

The structural defense is already live and needs no policing: **the Verified Work Record**. A
rotator's wallets are disposable, so each one accumulates a thin, one-entry history and is then
abandoned. An honest earner accumulates depth — the same wallet, across campaigns, across funders,
over time. Rotation buys a few extra slots today and forfeits the only asset the system issues.
The credit layer makes farming self-defeating, which is a better outcome than an arms race.

*Everything above is reproducible from public data: the campaign board, the payout receipts, and
the GOAT block explorer.*
