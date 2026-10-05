# Future Caribbean Demo Day: the plan

**Saturday 10 October 2026 · Finance & MSME Capital block · 1:15–2:45 PM AST (17:15–18:45 UTC,
22:15–23:45 Pakistan) · 6 minutes, live, from the laptop · no time slot, called live.**

## What the day is (and isn't)

FC's own words: declining to present "changes nothing else: your project still appears on Demo
Day and is judged exactly the same way." The score rides on what was already submitted. The talk
is for **the room**: investors, partners, sponsors, press, and the judges as people. That lowers
the stakes and tells us the goal: leave them sure Sage is real, and wanting a meeting.

FC disqualifies "materially false or misleading information", and every claim can be checked
(the receipts are public). So: **everything said as live is live; everything not yet built is on
the slide marked NEXT.** The live payment is the one thing nobody else in the block can do, and
the vision only lands if the room believes the live part.

## The format: a scripted talk with one live moment

- A deck (`stage.html`) carries the story, so a blank moment is survivable: read the headline.
- One live moment, about 75 seconds: Shariq submits work on his phone, and the room watches Sage
  check it and pay real money, then opens the public receipt.
- Every live panel in the deck is the real site in a frame (the ledger, the job's public page,
  the worker's record), preloaded so nothing loads on stage.
- A backup that is still true: **B** shows the same job from the rehearsal an hour earlier.
- The presenter window (press **P**) shows the script, the clock, the next slide and the fallback
  lines. It stays on the laptop; only the deck window is shared.

## Run it

The deck lives on the site itself: **https://sagepays.xyz/stage/index.html** (source:
`public/stage/`). It has to be served from sagepays.xyz: Sage's pages only run Privy inside a frame
whose parent is sagepays.xyz, and from anywhere else every framed page retries its sign-in frame
and stops painting. Open it in a clean Chrome profile that is not signed in to Sage.

Saturday's job is set by the URL, not a deploy:

```
https://sagepays.xyz/stage/index.html?live=<job>&backup=<job>&worker=<0x…>&pay=J$160&usd=1.02&network=Arc&refusals=26
```

Press **P** for the presenter window (it inherits the same query), **F** for full screen.
Printable script: the same URL with `&script=1`. GO / NO-GO:

```
node scripts/fc/stage-check.mjs "<the deck URL above>"
```

Keys: → / space next · ← back · T clock · B backup · L back to live · R reload the live page ·
O open the receipt · P presenter · F full screen.

## Who does what, by day

### Tuesday 6 Oct
- [x] AI back up: MiniMax's balance ran out on 28 Sep (every chat turn failed with a 402). The four
      lanes now run the same model, MiniMax-M3, through CommonStack. The judge passed its promotion
      battery on that route (57/57, zero wrong payouts) and is approved; deployed.
- [x] Kyvern's six processes stopped and removed from pm2 (they shared the two CPU cores with Sage).
- [x] Deck v1, script v1, this plan.
- [ ] **Shariq:** register "Yes, we'll present live" at os.futurecaribbean.com/registerfordemoday;
      decide the Project Gallery (recommended yes; it publishes the team fields from the form).
- [ ] **Shariq:** read the presentation format on that page and tell me the platform (Zoom,
      StreamYard, Riverside, …).
- [ ] **Shariq:** check the CommonStack balance and top it up (about $20). Every AI lane now runs
      on it; if it runs dry, the judge can't autopay and the live moment fails.
- [ ] **Shariq:** free 15–20 GB on the Mac (it is at 3 GB free).

### Wednesday 7 Oct
- [ ] **Shariq:** about $10 of USDC on Arc mainnet (via Across or Relay from Base / BNB Chain):
      ~3 to the operator `0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6` (gas), the rest into the
      workspace account on Arc (the jobs). Rehearsal payouts go to his own worker wallet.
- [ ] **Me:** Arc mainnet live: factory, config, deploy, first real payout and receipt.
- [ ] **Me:** the live job. Tune the wording and the proof page until the judge pays it 10 out
      of 10 on Arc testnet. A fresh job and a fresh page every run; the live job gets exactly one
      submission, the one on stage.
- [ ] **Me:** `stage-check` (one command, GO or NO-GO before going on).
- [ ] **Shariq:** read the script out loud three times; one recorded run with the deck.

### Thursday 8 Oct
- [ ] **Both:** dress rehearsal #1 on mainnet with a real payment, exactly as on Saturday.
- [ ] **Me:** fix whatever it shows; script v2 from where Shariq stumbles.

### Friday 9 Oct
- [ ] **Shariq:** three timed runs at 22:15 Pakistan time, same room, headset and network.
      Failure drills: unplug the router mid-run (switch to the hotspot), press B, blank on purpose
      and recover by reading the headline.
- [ ] **Product freeze at 18:00 Pakistan time.** No deploys after that unless something is broken.

### Saturday 10 Oct
- 18:00 PKT: `stage-check`, one full run.
- 20:45 PKT (T-90): post the live job (fresh), publish the proof page, invite the worker, open it on
  the phone, paste the link but don't submit. Update `stage-config.js` (live, backup, worker, the
  J$/USDC line, refusals count). Reload the deck.
- 21:30 PKT: join the session. Close everything else. Do Not Disturb on, Mac and phone.
- 22:15 PKT: the block starts. Be on, camera on, deck shared, presenter window open.

## The setup that makes a nervous presenter safe

- **Audio first.** Wired earphones with a mic at minimum. A bad sound loses a room faster than a
  bad slide.
- **Network:** the router, plus the phone hotspot tested as a fallback.
- **One Chrome window** for the deck, shared as a window (not the whole screen), so the presenter
  window, notifications and the phone mirror are never on stream.
- **The phone is the worker device:** charged, Auto-Lock off, Do Not Disturb on, signed in as the
  worker, the job open, the proof link already pasted. One tap on stage.
- **Water. The first three lines memorised. The rest can be read.**

## Rules for the live run (Sage's own guards would otherwise trip)

Every anti-farming check is per job, so: a fresh job and a fresh proof page for every rehearsal
and for the live run. Never resubmit to a job that already has a submission (a near-duplicate
is held for a person). Keep the live job invite-only: public work asks a first-time worker for a
World ID proof, and invite-only work pays at once without the 30-minute window.

## What is still open
- The platform, which decides how the presenter window and the camera sit.
- Arc mainnet funding; without it the live payment runs on GOAT mainnet (proven since July).
