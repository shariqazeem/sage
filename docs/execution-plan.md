# THE FINAL WEEK — one system, two submissions

Rewritten 2026-09-01 with the user, on the settled thesis (Opus draft, Grok stress-test).
**Future Caribbean closes Sat 6 Sep. STRK20 extended to Sun 7 Sep.** FC is the priority — Metis-
recommended, we hold their 1st-place signal, and the Finance/Payments/MSME track rewards exactly
what already exists. Both submissions come from ONE repo with different skins.

Prior week's results (batteries all green, 8 defects fixed, privacy events, shell/nav, posts) are
in git history and memory. This file is only what remains.

---

## The thesis, as it goes in both submissions

> **Agentic working-capital infrastructure.** Sage witnesses performance, a vault bounds the
> agent, rails discharge the obligation, the record is underwritable, and third-party capital can
> sit behind the same judge.

```
witness (agent)
  → obligation (signed, capped)
    → vault (cannot exceed)
      → router (GOAT public · STRK20 claim · fiat adapter next)
        → record (public tape or selective proof)
          → capital in (advance — THE transformation)
```

**Language rules (hard):**
- NEVER "we removed credit risk." Say: *waterfall on witnessed inflow — recourse on the
  Sage-routed remainder.* The borrower can stop using Sage; a Citi judge will say so in one line.
- "Sage doesn't read cash flow. It **witnesses** it. In markets where the books don't exist,
  Sage writes the book as the work happens."
- The **45% refusal rate is the institutional asset** — lead with it everywhere.
- Trade finance is the same loop with different evidence adapters — say "next adapter," never
  claim a test receipt is a bill of lading.
- CARICOM FX matching: one honest slide — netting becomes real on our own book when obligations
  exist in two currencies; not built this week because inventing counterparties is an app, not
  infrastructure.
- Fiat / crypto-banned: adapter INTERFACE + "mark paid via partner" stub, clearly labelled. The
  same verified credit event records either way — that is what makes it an infrastructure claim.
- STRK20 skin: *income that can be borrowed against without being a public diary.* Pool-native
  (claim → shield), viewing-key-shaped disclosure (floor attestation), matches how StarkWare
  itself pitches STRK20 (privacy as a mode of activity, not a mixer).

**First lender is US** (the Sage Advance pot). One advance, disbursed and repaid on mainnet with
receipts, beats any institutional letter of intent. The NYSE line: the facility works, the LP is
still us, the pipe is open for a credit union.

---

## FRESH REVIEW — Tue 2 Sep (Fable 5.1, read against the live product, not the plan)

**STRK20 — is the integration good enough to win?** Technically it is ahead of the field: a
Cairo vault that derives the reward itself and answers refusals with a code, escrow keyed by a
Poseidon commitment, gasless collection, a fully autonomous judge→vault→escrow→claim loop with
three mainnet payouts, mutation-verified money guards, a control-row dry-run — and as of tonight
the fourth qualifying tx: the agent-decided payout **collected into a shielded note**
(`0x2765387…dbfe4`, `ClaimedPrivately`, 19:03 UTC). What decides a PRIVACY hackathon is not more
rail — it is (a) a precise honest claim (we have it), (b) the claim being FULLY true → **the
privacy class must be declared** (today the vault still names recipients in its events; the
package says "pending" in as many words), (c) real usage → **the $10 gig must be live** so the
traction post carries real numbers, and (d) first-touch legibility → the landing currently says
"on GOAT Network" everywhere and shows GOAT-only totals: the STRK20 judge's first screen erases
the rail being judged. Fixed today (objective).

**FC — where the build stands.** The finance layer is complete and live (advance, waterfall,
record, lender, attestation, fiat interface, outcomes, local currencies, gigs + grants certified,
one settled ledger, data room). The two proofs that win it are user-gated (grant film, mainnet
advance). The product-side gaps a judge FEELS: the landing reads as a clever demo rather than an
infrastructure company (riddle hero, sketch illustration, wrong/GOAT-only numbers, "0% refused"
where the ledger says 43% — the refusal rate is THE institutional asset and the front door denies
it), and there is no story for a COMPANY using Sage privately for its own people — which is the
MSME backbone claim made concrete. Both are buildable this week.

## STATE — Wed 3 Sep, early (Fable 5.1)

- **Privacy class DECLARED and LIVE for new vaults** (`0x6d5577…`, tx `0x29abc18…fb87f`); the three
  earlier vaults stay recognised via `STARKNET_VAULT_CLASS_HASHES_PREVIOUS` (pinned). The gig can
  launch NOW on the class that names nobody.
- **Deployed:** the rebuilt landing (plain hero, live rail, three doors, facts strip, a real run in
  "how it works", Sage-for-teams scene), the composer with its live plan preview, the empty-desk
  door, the manifest with a real vault instance + the 4th tx.
- **P-GEN nonce 44** running detached on the VM (VM-local log; 42/43 were relaunches — the ssh relay
  goes silent, always run batteries detached and read the VM file).

## WHAT NEEDS YOU — Wed 3 Sep

1. **Fund + launch the $10 STRK20 gig** — it deploys from the privacy class now. Posts in
   `docs/posts/LAUNCH-KIT.md`; the series order in `docs/posts/BUILD-IN-PUBLIC-BACKLOG.md`.
2. **Fund `0x3a60…8341` (≥$2.50 + gas) + second Telegram account** → grant film.
3. **Record** — the teams post (`2026-09-02-sage-for-teams.md`) can be shot today on prod.

## WHAT NEEDS YOU — Tue 2 Sep (updated evening) — superseded above

**Top up ~20 STRK** to the operator `0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101`.
The privacy class (`0x6d5577…`, artifacts on the VM, key verified, `scripts/starknet-declare-env.mjs`
ready) estimates at **41.84 STRK** against a 27.29 balance — pure L2 gas for a 210 KB class, tip-
independent. The moment it lands I declare, set `STARKNET_VAULT_CLASS_HASH`, restart, and update
the packages. Then launch the gig. Everything else below stands.

### (superseded list)

1. ~~Declare the privacy vault class~~ **DECLARED 2 Sep** — `0x6d5577…`, tx `0x29abc18…fb87f`; production flips to it with the next deploy (old vaults stay recognised).
   *(was:)* Declare the privacy vault class (`scripts/starknet-deploy.mjs`, passphrase) → then set
   `STARKNET_VAULT_CLASS_HASH` on the VM to the new class and restart, so the gig deploys from it.
   Do this BEFORE launching the gig: the campaign that strangers touch should be the one that
   names nobody.
2. **Fund + launch the $10 STRK20 gig** (posts ready in `docs/posts/LAUNCH-KIT.md`).
3. **Fund `0x3a60…8341` (≥$2.50 + gas) + second Telegram account** → grant film per runbook.
4. **Record the videos** — after 2 and 3 exist, so the footage is real money.
5. ~~Collect the outstanding claim~~ **DONE** — 4th tx in `strk20.json`, served at the demo URL.

## BUILD 5 — the front door (landing + onboarding as a million-dollar infra product)

Method: change what a stranger reads in the first 10 seconds, not the palette.
- [x] **Numbers: one ledger, every rail** — SHIPPED Tue: the front door now reads $52.60 · 29 ·
      across GOAT Network + Starknet · 23 refused on record, from the same rows as the explorer.
- [x] **Hero** (Tue, built + gated, deploy waits for the running P-GEN): "Pay people for work
      an AI has verified." + the three doors (founders & teams · workers · lenders).
- [x] **The product, not a sketch** (Tue): the hero's right column is the LIVE settlement rail;
      "how it works" shows a REAL run — the mission, its observed criteria, the verdict with the
      judge's verbatim quote, linking to the receipt (`loadShowcase`, pinned; empty ledger → the
      illustration). New scene: Sage for teams.
- [x] **Facts strip** (Tue): rails · settled+refused live · six batteries · open source · Metis
      1st place — every item a link.
- [ ] **Onboarding** — `/launch` is already clean; add "what happens next" (approve → fund →
      watch → receipts), the walletless door, and a first-campaign path under 3 minutes.

## BUILD 6 — Sage for teams (a company pays its own people, privately)

The FC backbone claim made concrete: an employer/MSME hands gigs and milestone grants to its
own staff or contractors, verified and paid the same way, without listing them publicly and
with private-capable payouts. HARD CAP one day — if it cannot be REAL in a day it is a roadmap
slide, never a mock.
- [x] `visibility: listed | unlisted` (migration 0050, default listed) — hidden in `marketplace()`,
      the ONE listing source (board, sitemap, the agent's mission list); explorer untouched.
- [x] Invite link: the founder console shows the `/c/<id>` door with a copy button; the door
      tells an invited person why it is not on the board.
- [x] "Only people I invite" on BOTH pay doors (the sentence form at `?do=pay` and
      `/launch/direct`) + the `invite only` chip on dashboard rows.
- [x] Pinned: hidden while its listed twin shows · still real at its door · default listed ·
      visibility rides the schema · unknown words refused. SHIPPED Tue 2 Sep.
      Deploy lesson (2nd time): paths with `(group)`/`[param]` break rsync's remote shell —
      stream via `ssh "cat > '<path>'"`; the checksum loop is what caught it.

## WIDTH — every working surface is a board (user, Wed)

The launch page sat in a 760px column on a 1440px screen and stacked the composer vertically
beside acres of paper. Now the launch family, explorer, lender and record take the board recipe
(full width past the rail, 1320px ceiling, 16px sides on phones; /proof keeps its receipt
column; the tester board goes 720→960 and stays a column by design; /outcomes stays a reading
page). Measured at 1440/1024/390. Deploys with the battery batch.

## BUILD 7 — the composer (gigs · bounties · grants as a daily tool)

The pay door is the surface founders, companies and teams will touch every day, and today it
is a fill-in-the-blanks sentence. Rebuild it as a real composer, same server contract:
- [x] Kind up front (gig · bounty · milestone grant), who, currency, invite-only — one card. (Tue)
- [x] Deliverables as row-cards: pays · what must be true · how Sage verifies, in plain words. (Tue)
- [x] **Live plan preview** beside the form — exact split, each contract in words, door, who,
      "refuses if…", "then…" — verified reacting to typing on the local preview. (Tue)
- [x] Templates kept as chips; the compile → plan → fund path unchanged. Deploy waits for P-GEN.
- [ ] After deploy: compose a real gig and a real J$ grant end-to-end on prod, screen-record it (P2).

## QUALITY ROUND — the agentic lanes before the campaigns launch (user, Tue)

MiniMax-M3 is free through FC; spend it on quality, keep the lanes portable so the next provider
is a config change. One battery at a time on the VM, NOTHING else there during a run.
- [x] **P-GEN nonce 44 read as it runs** (Wed): missions are grounded and specific (page-weight
      audit against the site's own claim; sidebar navigation Sage verifies by fetching). Two real
      defects found by READING, both fixed and pinned: (1) a bare `token` in the category hints
      framed tailwindcss.com/docs and plausible.io as web3 for the mission brain; (2) on the
      fair-capacity path the top mission absorbed the pot into the model's tiny count — $76.39 × 2
      for a 12-minute signup, $55.74 × 3 for a 30-minute docs task — `spreadOverpaidMissions`
      now sends the same pot to more people at the fair rate (allocator untouched, Σ exact).
      Deploy after the battery finishes.
- [x] Third defect from reading (Wed): coverage was capped by the prompt itself — "design 3–6
      candidate missions" — so a rich store got three missions and spent $15.80 of $4,416.
      The architect now designs one mission per distinct observed flow (4–6 small, 6–10 rich;
      never padded). Prompt `mb-v4.2-qa`. **Validated by P-GEN 45 after deploy, anchors must
      stay 100%** — the standing policy for any mission-brain change.
- [x] **P-GEN 44 baseline (Wed):** 13/13, anchors 100% every row, no failures, ~231k tokens;
      coverage flagged two one-mission plans (spa-app, webgl-world) — the cap the prompt change
      lifts. Deployed the batch (categorizer, fair spread, mb-v4.2-qa, the board-width pass,
      landing cleanup) → **P-GEN 45 running** to validate: anchors must stay 100%, coverage should rise.
- [x] **Fourth defect, from reading P-GEN 45's plausible row (Wed):** the spread had not taken —
      the wall was DIVISIBILITY, not the count: the remainder 143,127,302 base units has no
      divisor ≤ 48 but 2, so the frozen allocator's exact-division search could only write
      $71.56 × 2. Fix on the capped path: pay the pot at the fair rate to n people and return the
      sub-cent residual to the founder (capacity is not their money) — Σ exact against the shrunk
      budget. Pinned on the brain's exact inputs. Deploys after P-GEN 45 → validated by P-GEN 46.
- [x] **Fifth, from reading P-GEN 45 (Wed):** plausible.io's four missions had three ending on the
      registration page — "distinct means distinct: missions ending on the same page merge"
      (`mb-v4.3-qa`). P-GEN 45 so far: excalidraw 1→4, play2048 2→5, tailwind correctly "docs".
      Deploys with the 28-file batch after 45 → **P-GEN 46 validates divisibility + v4.3 together.**
- [x] **Sixth, from reading P-GEN 45's yara.garden row (Wed):** the count rule has TWO edges. The
      v4.2 rule read as "one flow → one mission" collapsed an 18-state interactive world into ONE
      onboarding mission (v4.1 had designed four: intake, location tabs, notes, companion switch).
      The critic accepted it on every rubric point; the deterministic gate refused it for a single
      empty prose field (`verificationMethod`); the corrective round re-emitted the same lone
      mission; the founder got `needs_input` with two generic questions. Three caller-side fixes,
      no frozen layer touched: (1) the rule now states a FLOOR — flows are counted from the map's
      distinct states, a linear onboarding is ONE mission and everything after it is its own, a
      map of 8+ states never yields fewer than three (`mb-v4.4-qa`); (2) a missing verification
      method is stated by code from the mission's evidence shape — the gate still refuses an EMPTY
      one, so this is a fill, not a weakening; (3) a gate-only death on a reviewer-accepted
      candidate steers the corrective round to re-emit complete and WIDEN, instead of "design
      different missions". Pinned by `mission-brain-coerce.test.ts` + `mission-prompt.floor.test.ts`.
      Row 6 itself was the 1500s battery timeout: the brain took 106s; the field test on 18 states
      took the rest — a latency fact to watch, not a defect. Ships in the batch; P-GEN 46 judges it.
- [x] **P-GEN 45 grid (Wed):** 12/13 PASS, anchors 100% on every completed row, coverage PASS on
      all of them (spa-app 1→4, webgl-world 1→5, canvas-game 2→5), ~227k tokens. The one failure is
      the dom-world timeout — the sixth finding, fixed in the batch. Rows read for defects: allbirds,
      telegram (no invented login step), brittanychiang (critic killed a link inventory; the reward
      is finding four, fixed in the batch), gitlab-fr (verbatim French anchors), agora (two reading
      missions → the floor now says flows, never reading). **Batch deployed → P-GEN 46 validates
      divisibility + v4.4 together; anchors must stay 100%.**
- [x] **Seventh, from reading P-GEN 45's uniswap row (Wed):** the critic's prompt cuts the candidates
      JSON at 20k chars. Five rich missions ran 23,109 chars, the fifth arrived cut mid-criterion, the
      critic honestly said "the submitted mission text is truncated" and the mission died — its
      stored text complete. Measured across the run: rows sit at 14–17k with 4–5 missions, so the
      6–10 the count rule now designs would cut the tail of EVERY rich plan. The critic now reviews
      in batches under the cap (`batchForCritic`, 16k), each against the full map, verdicts
      concatenated; pinned by `mission-brain-critic-batch.test.ts` incl. a structural read that the
      batch cap stays under the builder's cut. Two lists that drift, again: the architect's count
      and the critic's cap were two numbers that had to agree. Ships after P-GEN 46 → P-GEN 47.
- [x] **Eighth, from P-GEN 46's failures (Wed):** plausible.io and allbirds.com FAILED as
      `provider_timeout` with no brain output — the MiniMax architect call crossed the lane's 180s
      timeout twice on each (successful calls in the same run ran 98–177s; the profile's comment
      still said "measured 63–151s"). A timeout must cover the tail of the job it guards: 300s.
      Same run, same shape: the USER prompt still said "Design 3 to 6 missions" under a system
      rule that says 4–6/6–10 — the band is now derived from the map (8+ states or a wide crawl →
      6–10) and one test reads both texts. Ships with the critic batching → **P-GEN 47.**
- [x] **P-GEN 46 stopped at 9 rows (Wed):** every row that produced a plan held anchors 100%;
      yara.garden now plans (3 missions, was a dead-end); the two failures and the telegram row's
      battery timeout were all the eighth finding (the 180s lane timeout), so the remaining rows
      would have measured nothing new. Deployed the critic batching + 300s timeout + derived count
      band and pushed. **P-GEN 47 running — the validation of the whole batch: anchors 100%,
      no provider_timeout row, rich maps at 6–10 missions, tails reviewed whole.**
- [x] **Ninth, from P-GEN 47's first row (Wed):** motherfuckingwebsite.com — one page — died as
      `provider_timeout` after the MiniMax architect crossed the new 300s twice, while the same
      provider answered a trivial prompt in 2s. The mission lane had NO failover: the ladder broke
      on the second timeout with `LLM_FALLBACK_*` (claude-haiku-4-5, fast) configured and idle.
      Now: after the second timeout the architect makes ONE attempt on the secondary provider,
      and a timed-out critic review does the same; `model`/`provider` record who answered so a
      fallback plan is never mistaken for a primary one; the gate judges both alike. `useFallback`
      is fail-closed (no fallback → `llm_not_configured`, never a silent re-run of the primary).
      Pinned by `src/lib/llm/fallback.test.ts` + a structural read of the ladder. → P-GEN 48.
- [x] **Tenth, from P-GEN 48 (Wed) — the "heavy tail" was ours, twice over:** (1) every LLM call in
      the process is serialized, and the abort timer started when a call JOINED the queue, not when
      it reached the provider — a one-page site behind two 130s generations had spent its 300s
      before it started and was recorded `provider_timeout` while the provider answered a trivial
      prompt in 2s. The timer now arms inside the queue slot. (2) The architect's answer budget was
      a flat 4,200 tokens; a real six-mission plan measures ~6.6k (22,110 chars, ~1,100/mission), so
      every plan the count rule now designs truncated, the ladder re-generated for minutes, and the
      retries ran into the timeout. The budget now scales with the band (7k small / 11k rich) and
      the timeout never sits below producing that budget at 40 tok/s (measured 57). P-GEN 48 rows
      that did land: tailwind 2→5 missions, all anchors 100%. Stopped at 9 rows → **P-GEN 49.**
- [x] **P-GEN 49 (Wed night) — the first fully green run of the new stack:** 13/13 ready, anchors
      100% every row, zero failures, zero timeouts, every brain call answered by the primary in
      65–258s (the scaled timeout covered the tail; the fallback was never needed), ~242k tokens.
      Counts: yara 6 (was a dead-end), allbirds 7, play2048 6, telegram 5, cnn 5, agora 5. The
      grid's one soft flag: docs planned ONE mission (a $200 install quickstart) — the rule's
      "never reading missions" over-applied to documentation. `mb-v4.5-qa` names the docs flows
      (search, navigation, quickstart-to-working-result, interactive examples/toggles). Deploys
      after the P-DIRECT dump; the docs row of P-GEN 50 validates it.
- [x] **P-DIRECT dump (Thu):** 20/21 fixtures compiled; the one failure, `pd-grant-currency-tranches`,
      was a TOOL-SCHEMA DRIFT: the compiler accepts `currency` and a milestone's `rewardLocal`, the
      field descriptions told the model to pass them, and the JSON schema the model is shown never
      declared either (nor `visibility`). The model cannot send what it is not shown. Declared all
      three, the mapper forwards `visibility`, and `direct-tool-schema.drift.test.ts` reads the zod
      schema against the tool schema so the two lists cannot drift again.
- [x] **Copied work across wallets (Thu, from the user's question):** an artifact contract binds a
      page to a wallet by its marker; a fork of an honest page with the marker swapped had different
      bytes and a different report, and nothing looked at the body. Now the artifact verifier returns
      a MinHash fingerprint of the fetched body (marker stripped), it is persisted on the decision
      (migration 0052), and `findCopiedArtifact` holds a near-identical artifact at the same
      calibrated threshold as report paraphrase — artifact_url lanes only, never the shared product
      page; HELD for review, never auto-rejected. Pinned by `fingerprint.test.ts` +
      `dedup-artifact.test.ts`. Next layer if time allows: GitHub provenance (fork flag, repo
      created before the gig).
- [x] **GitHub provenance (Thu):** for a github.com artifact that verifies, Sage reads the public
      repository record: a FORK, or a repository created more than a day before the gig existed,
      is held for the founder with a plain reason (the marker proves the page is theirs NOW, not
      that the work was done FOR this gig). A rate-limited or unreachable API yields NO signal —
      an honest tester is never held for GitHub's limit. `GITHUB_TOKEN` (optional) only raises
      the limit. Pinned by `github-provenance.test.ts` + `work-proof-github.test.ts`.
- [ ] P-DIRECT in dump mode (`DIRECT_DUMP=1`) — read the model's gig/grant plans in words.
- [x] **P-JUDGE (Thu, MiniMax-M3, 3 runs):** zero wrong-autopay across 57/57 valid rows, no provider
      failures, promotion-eligible and conclusive. Every hostile fixture held (direct, paraphrased,
      Spanish and zero-width injections; stale reused artifact; wrong product / wrong route; spam;
      JS-only shell; authorless evidence; author-date mismatch; eloquent note over thin evidence);
      genuine rich evidence auto-paid 3/3; terse and feedback-style genuine work went to review,
      never to a wrong pay. The judge is what it claims to be.
- [ ] P-WORK (gig judging) — running next; read the briefs.
- [ ] Fix what reading exposes — prompts and gates — then re-run the touched battery.

## VIDEOS + POSTS — built Wed (`docs/posts/series/`, `docs/posts/videos/`)

Real footage only: `scripts/video/capture.mjs` screenshots the live product, `render.mjs` turns a
storyboard into an H.264 mp4 (camera + captions in the product's own type). Six delivered: the
opener montage (42s) and one-idea singles — ledger, credit file + advance, composer, teams,
private payouts (pairs with the gig launch). One post per day; link in the first reply.

## POSTS — after the builds, one feature per post, each a screen recording + copy I write

| # | when | feature | proof in the frame |
| --- | --- | --- | --- |
| P1 | Wed/Thu | STRK20 gig live: "paid $X to N people — nobody can read their income" | claim into a shielded note, explorer rows |
| P2 | Thu | Caribbean currencies: a J$ grant composed, priced once, paid | launch form → outcomes reading |
| P3 | Thu/Fri | The grant film: two tranches to a walletless seller | Telegram + record page |
| P4 | Fri | The advance: verified inflow → capital → waterfall receipt | /lender → /record |
| P5 | Fri | Sage for teams: a company pays its own people privately | unlisted campaign → private payout |
Results post tags ellibenson on RESULTS only (existing rule).

## The week, re-cut

| | |
| --- | --- |
| **Tue 2** | Landing numbers fix (ship). BUILD 5 hero/doors/trust. User: declare class, fund + launch gig. |
| **Wed 3** | BUILD 5 done. BUILD 6 (teams) built + tested. Grant film if funded; advance the moment an earner exists. |
| **Thu 4** | P1 + P2 posted with real numbers. Recordings. Fixes from what the recordings expose. |
| **Fri 5** | P3–P5. Final cross-read of both packages against the live site. Code freeze by evening. |
| **Sat 6** | **FC submitted. STRK20 submitted the same day.** |

### What landed Wed → Thu (overnight, autonomous) · what needs you Thursday

**Needs you (in order):**
1. **Fund + launch the $25 gig** — 8–10 people, Starknet, public, the write-up gig in
   `docs/posts/CAMPAIGN-25.md`. Prod is on the new mission stack (below); the composer's "Pay a
   supplier" template and the invite door are live if you want the gig unlisted first.
2. **Post 2 (18:30 PKT) and post 5 (23:00 PKT)** from `docs/posts/series/` — copy is written, videos
   rendered at 1920×1080 in `docs/posts/videos/`. Link goes in the first reply, never the body.
3. Nothing else is blocked on you. Batteries continue on the VM one at a time; every deploy is
   guarded, checksummed, and pushed.

**What landed (all deployed to prod, pushed to main, gate green at 4,063 tests):**
- The quality round found **ten defects by reading generated plans** — none visible in a green grid
  (the list is in the section below). The last four were the mission brain's own failure modes on
  rich products: a count rule with a ceiling but no floor, the critic's prompt cutting the last
  mission, a lane timeout below the architect's tail, and an abort timer that started before the
  process-wide LLM queue. **P-GEN 49 is the first fully green run of the new stack: 13/13, anchors
  100%, zero timeouts.** `mb-v4.5-qa` (docs flows named) deploys after the money-lane dump.
- Wallet links (EVM ↔ Starknet, both sessions required) are live: a business can present one
  record; the lender JSON carries `linked`.
- Three batteries were **stopped early** once their remaining rows could only re-measure a defect
  already fixed — an hour each of a five-day window.

**Watch (not urgent):** the fallback provider was never needed in P-GEN 49; a url-verifiable-only
plan on a wallet-gated product spends ~$11 of a $4.9k budget (capacity = the model's own counts) —
honest, but a founder-facing weakness to decide on after the deadline, not before.

### Launch runway pre-flight (Mon night — clear for your funding tomorrow)

GOAT head fresh (4s) · operator gas covers **~1,547 settlements** at the last settle's cost ·
Starknet RPC live (block 14.18M) + operator configured · `deputy-watch` online 2d (autopilot
ticks alive) · sweep endpoint fails closed · lanes: MiniMax-M3 on PAYOUT/CONCIERGE/MISSION,
Haiku on OBS_JUDGE, Gemini-Flash-Lite on VISION, fallback armed · disk 62%. Crossmint spike is
credential-gated: no CROSSMINT key on the VM — needs a staging key from you when its turn comes.

### What landed overnight (Mon → Tue)

- **P-DIRECT CERTIFIED** — two conclusive rounds + targeted 3/3 currency certification; money
  invariants perfect; the battery gave up its last three quote-less calls; lint made total.
- **Watch-don't-chat shipped**: the dashboard desk is LIVE (15s poll, honest heartbeat,
  proven in-browser: a settlement arrived as "Paid $0.50 · proof" on an untouched page).
- **The friction audit's big find, fixed end-to-end**: four surfaces derived "money settled"
  four ways (three totals on one day) — and two real Starknet payouts had NEVER reached the
  events journal. Journal now writes on the dispatch (both rails, every caller), prod rows
  backfilled, `settledLedger()` is the one derivation with NAMED scopes, drift-tested.
  Live now: explorer/outcomes-flow **$52.60/29** · marketplace/launch/outcomes-access
  **$50.60/26/21 people** (dogfood excluded).
- **Both submission packages assembled Monday** (Friday is now review-only): FC data room
  (`docs/fc/data-room.md`, all 9 links verified 200) and STRK20
  (`docs/strk20/submission.md`; manifest now lists BOTH contracts and serves at
  https://sagepays.xyz/strk20.json, with a two-copies drift test).
- P-ROUTE diagnostics read: green and conclusive; the lone ⚠ is the known reasoning-model
  flake. Plan reconciled with built reality (BUILD 1 boxes, rail picker).

---

## BUILD 1 — Sage Advance (capital in + waterfall) · the transformation

The one genuinely new layer. Everything else exists.

- [x] **Schema**: `advances` (borrower wallet, principal base, published terms: multiple,
      waterfall fraction, pot address) + `advance_repayments` (payout id, leg amount, claim tx).
      Migration. Deterministic formulas only — Sage still scores nobody.
- [x] **Disbursement**: pot → claim link to the borrower (reuses SageClaims; the advance itself is
      private-capable). Operator-signed, capped by `advanceCapacityUsd` (exists).
- [x] **Waterfall — NO NEW CAIRO**: on the claims rail, `escrowPayouts` mints TWO legs via
      `deposit_many` when the earner has an outstanding advance: repayment leg (pot's secret) +
      remainder (worker's). Deterministic fraction from the advance terms. Vault flow byte-
      untouched; this is additive AFTER the vault call in `settle-starknet.ts` (frozen-listed —
      explicitly authorized by the user for this build; full test + mutation discipline; EVM flow
      not touched — GOAT is "the next adapter" and we say so).
- [x] **Record**: `/record` shows advance outstanding / repaid-via-N-payouts with the published
      arithmetic. Repayment history IS the credit story lenders ask for.
- [x] **Surface**: advance offer card on `/record` + "Fund this advance" on `/lender`
      (lender supplies the multiple — `advanceCapacityUsd` already enforces the philosophy).
- [ ] **THE PROOF**: one real advance on mainnet — worker with a real record takes an advance →
      their next verified payout auto-splits → both legs' receipts land on `/record` and
      `/explorer`. This is the FC demo's climax.

*(All five build boxes above VERIFIED BUILT 1 Sep — `src/lib/advance/` + `src/lib/db/advances.ts` +
migration 0049, `scripts/advance.mjs` claim-link disbursement, the waterfall block in the frozen-listed
`settle-starknet.ts` (user-authorized), the advance section live on `/record`, the facility on `/lender`.
Only THE PROOF remains, and it needs a funded campaign + a real earner — user-gated.)*

## BUILD 2 — milestone grants proven + direct-lane recall

Grants have run in production ZERO times and are the FC centrepiece.

- [ ] **READY — runbook at `docs/runbooks/grant-e2e.md`**, every prerequisite verified on prod
      except the two user items (fund the agent wallet `0x3a60…8341` ≥$2.50 USDC + gas; second
      Telegram account). One real milestone grant end-to-end: walletless recipient —
      invite → earn → verify → pay → cash out → record. Caribbean-flavoured framing
      ("fund a market seller in two tranches") so the run IS the film.
- [x] Fix the over-eager route (1 Sep): `testimony-condition.ts` — a deterministic
      AUTHORITY/DECISION/APPLICATION gate wired into the concierge before stated-terms; "when
      the bank approves her loan" now gets the honest refusal, never a campaign.
- [x] **P-DIRECT CERTIFIED (1 Sep, rounds 8–10).** Two conclusive full rounds (0 provider
      failures) with the money invariants PERFECT — budget violations 0, amount drift 0,
      invented milestones 0, unverifiable missions 0 — then a targeted 3/3-clean certification
      of the currency row (J$ tranches → stamped quote → exact split). Residuals are model
      flakes that pass in sibling rounds (no-tool 2/63) plus one correct schema refusal of an
      unpriced local amount. Along the way the battery itself gave up its last three quote-less
      calls (stated-terms, compile, budget check, lint) — and `lintDirectCampaign` is now TOTAL:
      advice can never crash a caller again. Decision rule honored: stop burning rounds.

### P-ROUTE standing (read 1 Sep)

The last full run is GREEN and conclusive: 31/32, providerFailures 0, prematureConfirms 0.
The single ⚠ (pr-web-gig run 2/2) is the reasoning-model flake documented in
[[reasoning-model-portability]] — the `<think>` block consumed the turn and no tool call
emerged; the same fixture routes correctly in run 1. Model variance, not a routing defect;
nothing to fix.

## BUILD 3 — STRK20 completion

- [ ] **Declare the privacy class** (user: password) → new campaigns stop naming people in
      `PayoutReleased`/`PayoutRefused`; README/docs claims upgrade to what is then deployed.
- [ ] **4th qualifying pool tx**: user collects the outstanding autonomous-payout claim into a
      shielded note → add to `strk20.json` (the only agent-decided one on the list).
- [x] **Floor attestation surfaced** (1 Sep): the earner issues a signed lifetime floor on their
      withheld record (owner-gated, EVM signing; Starknet stated as next); the lender pastes and
      verifies it on /lender — subject-match trap covered, per-active-month arithmetic in floors
      only, issuer published for off-platform verification. Proven live: prod refused a
      foreign-signed document with "signed by a different issuer".
- [ ] Campaign live for STRK20 people ($10 gig — posts ready in `docs/posts/LAUNCH-KIT.md`).

## BUILD 3.5 — the web app as the product (user directive, 1 Sep)

**"Focus on sagepays.xyz over Telegram for both submissions."** The app must: work easy, look
million-dollar, do everything inside itself, and feel like ONE ecosystem — every surface connected.
Method: walk the real journeys first, name the friction concretely, fix the top items — never a
blind repaint. Telegram stays (it is proven infrastructure), but the WEB is what judges touch.

- [x] Friction audit walked (1 Sep) — marketplace, launch, explorer, record, outcomes, claim,
      dashboard. THE find: four surfaces derived "money settled" four ways and showed three
      different totals on one day — including a rail whose manually-approved settlements never
      reached the events journal at all (two real Starknet payouts, invisible on the page headed
      "Every settlement").
- [x] Fixed the top disconnections (1 Sep): the settlement journal now writes on the DISPATCH
      (every caller, both rails; two prod rows backfilled from mission-derived amounts) and
      `settledLedger()` is the one derivation every money surface reads — explorer/outcomes-flow
      headline $52.60/29 (every settlement), marketplace/launch/outcomes-access $50.60/26/21
      (to testers, dogfood excluded). Different numbers now mean different NAMED scopes, never
      drift; the drift test asserts launch ≡ ledger on the same seeded rows. Still empty-board:
      the marketplace waits on the user's $10 campaign, a funding event, not a defect.
- [x] First ecosystem pass (1 Sep): both doors on the home, human greeting, ?do=pay deep door,
      console → briefed agent hand-off
- [x] **WATCH, DON'T CHAT (user thesis, 1 Sep) — SHIPPED same day.** The console's strip was
      already live (SageActivity, 5s poll); the founder's HOME was the gap — a server snapshot
      that said nothing while Sage judged and paid. Now `/api/founder/desk` (founder-scoped by
      construction, anonymous → empty desk with the loader never consulted, pinned) + a calm 15s
      poll with hidden-tab and sig-diff discipline; honest "worked Xm ago" heartbeat; one quiet
      380ms entrance per arriving row. Proven in the browser: page open and untouched, a
      submission made the section appear from empty, a settlement arrived as "Paid $0.50 · proof"
      with the heartbeat flipping to "worked just now".
- [x] Million-dollar pass, first sweep (1 Sep night): mobile walk of every money surface —
      marketplace, outcomes, explorer, record, lender, dashboard. One systemic fix shipped: the
      floating mode pill overlapped the first line of all four shelled money pages on mobile —
      one `--pill-clear` token, scoped on `html[data-app-shell="on"]` so /proof keeps its
      standalone spacing. Everything else measured clean (a suspected explorer row overlap was a
      screenshot-scaling artifact — the DOM shows a 12px gap). The user's own eye on Fri remains
      the final pass.

## BUILD 4 — FC package

- [x] Corridor line — live on /outcomes: the 8% corridor would have taken $4.21 of the $52.60 settled; recipients received it.
- [x] **Outcomes, not chains** — BUILT (`deploy/rail-choice.tsx`): the founder answers
      **Public receipts / Private-capable**, both options state their cost, the chain is fine
      print; the choice survives a reload (`rail-persistence.test.tsx` — the silent-revert trap
      is pinned).
- [ ] **DEFERRED TO THE END** (user, 1 Sep): Crossmint third-door spike — after the outcomes
      surface and infra-feel pass; "make the existing financial system work as one" first.
- [ ] **/outcomes — the brief's bar, answered with readings** (decided 1 Sep). One public page
      computing the four outcome bars from the LIVE ledger: cost vs the 7–9% corridor, speed
      (submission → settled, verification included), access (people paid, refusal integrity,
      the advance facility), flow (settled capital, funders, currencies, rails). Every number
      derived, every claim linked to receipts, gaps stated as NOT YET MEASURED. This is the
      infrastructure "feel": a system publishes its outcomes; an app publishes its features.
- [x] **Fiat adapter interface** (1 Sep): SETTLEMENT_DOORS registry + typed FiatDisbursement
      contract (cannot ship without the identical credit event) + real corridor quote + a disburse
      that refuses in words. Architecture doc: "Where crypto cannot go".
- [ ] Crossmint as that door's first implementation (spike rules unchanged, at the end).
      Real adapter implementation against Crossmint STAGING ($10 credits), honestly labelled:
      production pending compliance onboarding. Scenes it unlocks are the brief's own — diaspora
      card funds a grant (onramp), no-crypto recipient paid to an email wallet, fiat cash-out
      (offramp) — and the credit event records identically whichever door discharged it.
      HARD RULES: never touches GOAT/STRK20 rails (Crossmint supports neither — it is the third
      route, not a replacement); no fourth identity system (Privy already covers walletless);
      **1-hour timeboxed SPIKE FIRST** to verify chain list, credit coverage, and whether
      onramp/offramp geography actually holds for the US/CA/UK → Caribbean corridor — if it
      doesn't, it ships as an adapter demo and the doc says so. No claim that dies to one
      judge question.
- [x] Lender API verified + extended: work-record.v4 with the advances block through one redaction boundary; CSV export standing.
- [x] Submission overview refreshed (1 Sep) — two rails + outcome picker, the money path, the
      advance facility + waterfall, selective disclosure, /outcomes readings, v4 API; numbers
      re-read from the live DB ($52.60 · 29 payouts · 22 earners · 44% refused of 52); the two
      pending receipts named honestly (first advance round-trip; grant e2e). Data room;
      TRL update; demo videos (screen recordings — beat: the agent deciding, the split payout).
- [ ] Agentic quality holds for ANY product: the standing batteries stay the gate for every
      change (P-GEN for inspection-side, P-DIRECT for money lanes, P-WORK for gig judging).

---

## The week

| day | ships |
|---|---|
| **Mon 1** | Campaigns LIVE first (STRK20 gig + fund grant demo) — strangers need wall-clock. User: declare class, collect claim (4th tx), 2nd TG account. Me: refusal gate + recall fixes; advance schema. |
| **Tue 2** | Milestone grant e2e (the film). Advance disbursement + surfaces. Launch post is out; campaign post fires. |
| **Wed 3** | Waterfall implementation + mutation tests. **The real advance on mainnet.** |
| **Thu 4** | Floor attestation in lender flow. Fiat adapter stub + corridor line. P-DIRECT re-run. |
| **Fri 5** | Both submission packages assembled; demo videos recorded; results post (tag ellibenson only on RESULTS). |
| **Sat 6** | **FC SUBMITTED (deadline).** STRK20 package final; submit same day — never use the Sun buffer by plan. |
| **Sun 7** | Buffer only. |

**Standing rules carry over**: deploy guard (0 pending/settling), checksum-verify every synced
file, batteries one-at-a-time on a quiet box, mutation-test every new guard, decisions are cached,
push main after green deploys, every number in a submission read from the chain or the DB — never
typed.
