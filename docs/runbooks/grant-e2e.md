# Runbook — the first milestone grant, end to end (and the FC film)

The loop that has NEVER run in production: **invite → earn → verify → pay → cash out → record**,
for a person with no wallet. This run is simultaneously the FC demo, the unproven public claim,
and the first live exercise of three subsystems. Written 2026-09-01; every prerequisite below was
verified on prod that night.

**Rail truth, stated up front:** this run is the GOAT rail (the walletless founder wallet is EVM).
The advance/waterfall proof is a SEPARATE run on the Starknet gig earner — the waterfall splits
escrow legs in the Starknet settler only. Do not promise a cross-rail waterfall; we did not build
one this week.

## Preconditions — all ✓ verified on prod 2026-09-01, except the two user items

| check | state |
|---|---|
| Telegram bot + webhook secrets | ✓ set |
| Privy app id + secret (walletless mint) | ✓ set |
| Recipient loop files deployed (onboarding, tools, submit, withdraw) | ✓ all six |
| `DEPUTY_AUTOPILOT_MAINNET` | ✓ armed |
| Agent wallet exists | ✓ `0x3a60aF43c67dd9D552f180d30d9A042948078341`, chain 2345 |
| **Agent wallet funded** | ✗ **$0.00 USDC, gas dust — USER: send ≥$2.50 USDC + a little BTC gas** |
| **Second Telegram account** | ✗ **USER** |
| Nothing else running on the VM (no batteries during the run) | operator discipline |

## The founder sentence (say it to @sagedeputybot, verbatim shape)

> Set up a milestone grant: $2 total for a market seller I'll invite — half when she publishes her
> catalogue page with her wallet address on it, half when she posts her first customer review page.

Why this shape: it exercises `splitTotalUsd` (the "half and half" path P-DIRECT drove to green),
compiles to two `artifact_url` milestones with the wallet marker, and names an invitee so the
campaign converts to invite-only on redemption instead of becoming an open bounty.

- Expect: a planUrl reply, ~$1.00 × 2 milestones. The plan is approved but UNFUNDED.
- Then: **"launch it with the agent wallet"** → `sage_fund_and_launch` funds + deploys from
  `0x3a60…8341`. Expect the live campaign link.
- Then: **"invite my recipient"** → `sage_invite_recipient` → a `t.me/...?start=rcp_…` deep link.
  Write-once; do not regenerate casually.

## The recipient (second account)

1. Open the deep link → `/start rcp_…` → Sage mints their Privy wallet. **Note the wallet address
   it announces — the page they publish must carry THAT address**, not any personal wallet.
2. Milestone 1 for real: publish the catalogue page (any public host; paste.rs is fine for the
   film) containing the minted wallet address. Send the link in chat → `sage_submit_work`.
3. Expect: "verifying" → then the PAID push with the receipt link, no human touching anything.
   (If it holds honestly, fix the page, resubmit — the retry loop is part of the product.)
4. Milestone 2 the same way (the review page).
5. **Cash out from chat**: "cash out to 0x…" → Sage reads back the exact amount and destination →
   "yes" → `sage_confirm_cash_out` (EIP-3009; recipient pays no gas, needs none).
6. Open `/record/<mintedWallet>` — grant entries, credit signals, the whole file.

## Film beats (screen recording, per VIDEO-SPECS rules — no live claim links on camera)

1. The founder sentence + the plan appearing (the agent structured money from speech)
2. "launch it with the agent wallet" → live link (funded, walletless)
3. The recipient's phone: deep link → "your wallet is ready" (a person with nothing, onboarded)
4. The submit → **the PAID push arriving** (the money shot — hold it)
5. Cash-out read-back + confirmation (no gas, no exchange, from chat)
6. `/record/<wallet>` scroll — "for someone banks pretend don't exist, this is the beginning of a
   real credit history" — the sentence the whole run proves

## Known traps (each measured previously — see memory/commits)

- **Decisions are CACHED.** A re-judge needs the stale decision row dropped; never edit a mission
  and expect a fresh verdict for free.
- The invite deep link is **write-once per recipient**; the campaign flips invite-only on FIRST
  redemption — open campaigns are never converted.
- The artifact must carry the **minted** wallet; the felt/checksum spelling family is already
  handled (markerVariants), but the WRONG wallet is an honest refusal.
- If the bot goes quiet: check `pm2 logs sage` before re-sending; the DM dedup means a second
  identical push is deliberately suppressed.
- Do NOT run any battery during the run — 2-core box, one LLM key.

## After the run

- [ ] Add both payout receipts + the record link to `docs/fc/submission-overview.md`
- [ ] Tick "milestone grant proven" in `docs/execution-plan.md`
- [ ] The Starknet gig earner (separate) becomes the advance borrower: `scripts/advance.mjs
      capacity <wallet>` → `disburse` → their next payout splits — THAT is the waterfall film.
