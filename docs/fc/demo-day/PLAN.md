# Future Caribbean Demo Day: the plan

**Saturday 10 October 2026 · Finance & MSME Capital block · 1:15–2:45 PM AST (17:15–18:45 UTC,
22:15–23:45 Pakistan) · 6 minutes, live, from the laptop · no time slot, called live.**

FC's own words: declining to present "changes nothing else … judged exactly the same way". The
score rides on what was already submitted; the talk is for the room (investors, partners, judges as
people). Everything said as live is live; everything not yet built is on the slide marked NEXT.

## The materials (all in this folder)

| File | What it is |
|---|---|
| `Sage-DemoDay.pptx` | The deck. Opens in Keynote and PowerPoint, all Arial, nothing substituted. Speaker notes carry the script. |
| `Sage-DemoDay-Script.pdf` | The printed script: setup checklist, then every slide's thumbnail beside its words and actions. |
| `SCRIPT.md` | The same words as text. |
| `deck/script.js` | THE ONE SOURCE of the words. Edit here, then rebuild. |
| `deck/build-deck.js` | Builds the deck; reads the live numbers from sagepays.xyz/caribbean at build time. |
| `deck/build-script.mjs` | Builds SCRIPT.md and the PDF (Keynote renders the thumbnails). |
| `deck/capture.mjs` | Captures the receipt and record screenshots for slides 8 and 9. |
| `../../../public/stage/shop.html` | The seller's price-list page (Blue Mahoe Crafts, a disclosed sample storefront). It must carry the worker's wallet. Edit, then `scripts/fc/push-stage.sh` (no rebuild needed). |
| `../../../scripts/fc/stage-check.mjs` | GO / NO-GO: `node scripts/fc/stage-check.mjs --job <campaignId> --worker <0x…>` |

Rebuild everything: `cd docs/fc/demo-day/deck && npm install && node build-deck.js && node build-script.mjs`

## The talk: one straight line

Keynote slides 1–7 → Cmd+Tab to Chrome (the live job page) → submit on the phone, watch it pay,
open the receipt → Cmd+Tab back to Keynote → slides 8–13. Slide 8 is a rehearsal receipt, so the
deck goes on the same way whether the live run paid or stalled; only one sentence changes.

## The live demo, as measured on 6 Oct (Arc testnet, the real prod judge and vault)

| | |
|---|---|
| Founder drafts the job from one sentence | 19.5 s (Sage wrote the criteria: 3 items, prices in J$, shop name, public page) |
| Launch from the account (vault create, approve, fund, activate) | 10–18 s |
| Worker submits → **paid** | 36–50 s · **5 of 5 paid** · confidence 97, 90, 90, 95, 95 % (autopay bar 85 %) |
| Judge call | ~20 s · $0.0009 per decision (MiniMax-M3 via CommonStack) |

The judge's only caveats: the page's honest "sample storefront" footnote (low) and a **fresh
wallet** (medium). The fresh-wallet signal disappears once the phone wallet has been paid once,
so the mainnet rehearsal on Saturday must use the same phone wallet as the live run.

## Saturday runbook (Pakistan time)

1. **19:00 · mainnet rehearsal.** Post the job (same sentence, invite-only) and launch it from the
   Arc account. On the phone, open the job, *Continue with email* (the seller's email), and note the
   wallet. Put that wallet in `public/stage/shop.html`, run `scripts/fc/push-stage.sh`. Submit
   `https://sagepays.xyz/stage/shop.html`. Watch it pay. (Slide 8's receipt; the wallet is no longer fresh.)
2. **19:45 · refresh the materials.** `node docs/fc/demo-day/deck/capture.mjs <receipt-url> <record-url>`,
   then `node build-deck.js && node build-script.mjs`. Print the script.
3. **20:45 · the live job.** Post and launch a FRESH job (never reuse one that has a submission). On
   the phone: open it, paste the shop link in the box, do not submit.
4. **Chrome:** `https://sagepays.xyz/c/<live-job>#activity`, full screen (Cmd+Ctrl+F).
5. **`node scripts/fc/stage-check.mjs --job <live-job> --worker <phone wallet>` must say GO.**
6. **21:30 · join the session.** Do Not Disturb on, Mac and phone. Keynote on slide 1. Share the whole screen.

## Still needed from Shariq

- [ ] Register "Yes, we'll present live" at os.futurecaribbean.com/registerfordemoday; tell me the platform.
- [ ] About $10 of USDC on Arc mainnet (Across or Relay from Base / BNB Chain). Until then the live
      run is tested on Arc testnet; the money moment on stage must be mainnet.
- [ ] Rehearse with the phone: the seller's email sign-in is the one step only Shariq can do.
- [ ] Three timed runs before Friday night, same room, headset and network.

## If they ask (networking after the talk)

- **How does Sage make money?** A flat $0.10 fee on every verified payment. Next, a margin on the
  working capital the record unlocks.
- **Who holds the money?** The buyer's own vault on chain. Sage can only pay out what the vault's
  rules allow, to a submitter whose work passed, once per person.
- **What stops fake work?** The agent opens the work itself and must quote it; near-duplicates,
  copied pages and wallet clusters are held; public work needs a one-time proof of personhood. It has
  refused about 4 in 10 submissions so far, each with its reason on the public ledger.
- **Why digital dollars?** Settles in minutes at a flat fee, and every payment is a receipt anyone
  can check, which is what makes the record worth lending against. Local cash-out comes through
  licensed partners; we have not signed one yet.
- **Traction?** Small and real: $73.71 settled, 41 mainnet payments, 24 people paid, since July.
  First place at the OpenClaw Summer Bootcamp. The next milestone is one programme or cooperative pilot.
