# Future Caribbean Demo Day: the plan

**Saturday 10 October 2026 · Finance & MSME Capital block · 1:15–2:45 PM AST (22:15–23:45 Pakistan) ·
6 minutes, live, from the laptop · called live, no slot.** The talk runs about **4:35**, so a stuck
moment still fits inside 6:00.

FC: declining to present "changes nothing else … judged exactly the same way". The talk is for the
room. Everything said as live is live; everything not built yet is on the slide marked NEXT.

## The shape: slides, then Sage itself, then slides

| | Where | What |
|---|---|---|
| 0:00–1:15 | Keynote 1–4 | Hook · the seller and the gap · what Sage is + first place + real money since July · "Let me show you" |
| 1:15–3:25 | **Chrome, buyer** | One sentence → **Draft with Sage** → the rules appear → invite-only → **Create the gig** → **Let Sage launch it from your account** → live |
| | **Chrome, seller** | Open the job → **Submit evidence** → shop link → **Sign + submit evidence** → watch Sage check it → **Paid** → open the receipt |
| 3:25–4:35 | Keynote 5–8 | Receipt + credit record (works whether the live run paid or stalled) · Next · the ask · close |

**Everything happens on the laptop**: the shared screen shows Keynote, then the buyer's Chrome window,
then the seller's Chrome window (a second Chrome profile or an Incognito window). No phone.

**The live part runs on Arc's test network, and the talk says so** ("test dollars, the real engine").
Real money is proven by the public ledger (41 mainnet payments on GOAT and Starknet since July) and
said on slides 3 and 4. Arc mainnet is not needed for Saturday: switching chains the day before a
live talk adds risk and changes nothing about the score. Do it properly after Demo Day.

## Measured on 9 Oct, clicking the real website (founder and seller in two browser sessions)

| Step | Time |
|---|---|
| Draft with Sage (sentence → steps, criteria, evidence rule, J$160, 1 person) | 18–29 s |
| Create the gig → plan page | 1.4 s |
| Let Sage launch it from your account (vault created, funded, active) | 7–14 s |
| Seller: Sign + submit evidence → **Paid** | 31 s |

Plus 5 of 5 paid through the API on 6 Oct (90–97 % confidence). The real-website run found one
defect, fixed and deployed on 9 Oct: with no headcount in the sentence the composer used the model's
guess ("anyone" → 3 people) and funded J$480 for a J$160 job. Now: no headcount means one payment.

## The materials

| File | What it is |
|---|---|
| `Sage-DemoDay.pptx` | The deck, 8 slides. Keynote or PowerPoint, Arial only. Speaker notes carry the script; slide 4's notes carry the whole browser walkthrough. |
| `Sage-DemoDay-Script.pdf` | Print it: setup checklist, then every step with its slide thumbnail or a BUYER / SELLER badge. |
| `SCRIPT.md` | The same words as text. |
| `deck/script.js` | The one source of the words. Edit, then `node build-deck.js && node build-script.mjs`. |
| `deck/job-draft.json` | The tested job brief, for the backup job. |
| `../../../public/stage/shop.html` | The seller's price list (Blue Mahoe Crafts, disclosed sample). Must carry the SELLER's wallet. Edit + `scripts/fc/push-stage.sh`. |
| `../../../scripts/fc/rehearse-ui.mjs` | Clicks the whole walkthrough on the real site (founder + seller sessions), timing each step, screenshotting each screen. |
| `../../../scripts/fc/rehearse-founder.mjs` | Creates / launches a job as the rehearsal founder (for the backup job). |
| `../../../scripts/fc/stage-check.mjs` | GO / NO-GO: `--job <backup> --worker <seller wallet> --buyer <buyer's Arc testnet account>` |

## Setup on the laptop

1. Share the ENTIRE screen. Do Not Disturb on. Every other app closed.
2. Keynote: the deck playing, slide 1.
3. Chrome BUYER window (normal profile, signed in to sagepays.xyz): tab 1 `sagepays.xyz/launch?do=pay`
   with the sentence already typed; tab 2 the backup job.
4. Chrome SELLER window (second profile or Incognito), signed in with the seller's email.
5. The shop link known by heart: `https://sagepays.xyz/stage/shop.html`.

## Before Saturday

- [ ] **Shariq:** in a second Chrome profile, sign in to sagepays.xyz as the seller (*Continue with
      email*, a second email). Tell me, and I put that wallet on the shop page.
- [ ] **Shariq:** free disk on the Mac (4.6 GB free on 9 Oct; aim for 15): `npm cache clean --force`
      clears 8.5 GB of cache, then old Downloads.
- [ ] **Both:** two full rehearsals with the real windows, timed.
- [ ] Register "Yes, we'll present live"; tell me the platform.

## Saturday (Pakistan time)

1. **19:00** · one full run exactly as on stage: buyer posts and launches, seller submits, it pays.
   (Pays the seller's wallet once, so the judge no longer flags it as fresh.)
2. **19:30** · `node docs/fc/demo-day/deck/capture.mjs <that receipt> <the seller's record>`, then
   `node build-deck.js && node build-script.mjs`. Print the script.
3. **20:30** · post and launch the BACKUP job, leave it untouched, open it in buyer tab 2.
4. **21:00** · type the sentence into buyer tab 1. Seller window signed in.
5. **21:15** · `node scripts/fc/stage-check.mjs --job <backup> --worker <seller wallet> --buyer <account>` → GO.
6. **21:30** · join the session. Keynote on slide 1.

## If they ask (networking)

- **How does Sage make money?** A flat $0.10 fee on every verified payment; next, a margin on the
  working capital the record unlocks.
- **Who holds the money?** The buyer's own vault on chain; Sage can only pay what its rules allow.
- **What stops fake work?** The agent opens the work itself and must quote it; duplicates, copied pages
  and wallet clusters are held; public work needs one proof of personhood. About 4 in 10 refused so far.
- **Why digital dollars?** Minutes, a flat fee, and a receipt anyone can check. Local cash-out comes
  through licensed partners; none signed yet.
- **Traction?** Small and real: $73.71 settled, 41 mainnet payments, 24 people paid since July; first
  place at the OpenClaw Summer Bootcamp. Next milestone: one programme or cooperative pilot.
