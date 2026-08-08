# Sage: what the agent actually does, and where it actually breaks

**Measured 2026-08-06 against the production database and live prod endpoints.** Every number
here came from a query, not from memory. Where I do not have evidence, it says so.

Read this before deciding what to build next. The short version: the money path works and is
proven, the browsing path is the growth blocker, and there is one architectural conflict that
makes every honest tester look like a fraud in our own records.

---

## The sample this is based on

Small. Say it out loud, because everything below is provisional.

| | count |
| --- | --- |
| Inspections ever run | **344** |
| Plans generated | 234 |
| Plans a founder approved and funded | **11** |
| Campaigns created | 13 (10 GOAT mainnet, 3 Metis Sepolia testnet) |
| Missions published | 16 |
| Tester submissions ever | **11** |
| Real payouts settled | **8** (6 on GOAT mainnet) |

Eleven submissions is not a dataset. It is enough to prove the loop closes and to expose
structural problems, and not enough to claim a success rate. Treat percentages below as
directional.

---

## Stage 1 — The founder's ask

Input: product URL, what they want proven, who should test, budget in USDC. Four fields, one
time. From there, the design principle is that Sage never asks again unless it genuinely
cannot proceed.

The goal is compiled into **ordered checkpoints** (`compileGoalJourney`) before any browsing
happens. "Make sure people can book a room" becomes entry → navigate → input → outcome, each
independently checkable, each carrying the exact words from the founder's request that demanded
it. That last part is the guard against scope drift: a checkpoint with no phrase to point at is
a requirement nobody asked for.

**This works.** It is also newly sellable on its own (`sage_goal_checkpoints`, $0.05).

---

## Stage 2 — Browsing (the weak link)

`FIELD_TEST_ENABLED=1` on prod, so Sage drives a real headless Chromium, not an HTML fetch. It
pursues the founder's goal rather than clicking decorations: it crosses onboarding, types
synthetic values into forms, and targets the next unmet checkpoint.

**What the data says:**

| pages inspected | jobs |
| --- | --- |
| 0 | **44** |
| 1 | **150** |
| 2–3 | 48 |
| 4–6 | 7 |
| 7+ | 95 |

Inspection duration: **p50 88 seconds, p90 231 seconds**, max 2.9 hours (one outlier).

Two things jump out.

**194 of 344 jobs saw one page or none.** Some of those are static-crawl zeros that the browser
later rescued, so `pages_inspected` understates the truth. But the outcome data confirms the
problem is real, not a metering artifact — see the next stage.

**Inspection is much faster than we advertise.** The OKX listing and the MCP tool description
both say "4 to 11 minutes." The real p90 is under 4 minutes and the median is a minute and a
half. We are talking founders out of trying it for no reason.

---

## Stage 3 — Mission design, and the 28% wall

Architect proposes, critic reviews, a deterministic gate disposes. Model output is untrusted
until it passes `validate-mission.ts`. All 234 stored revisions passed validation, which sounds
great until you see what happens to the ones that never got that far.

| outcome of 344 inspections | count | share |
| --- | --- | --- |
| ready (a plan exists) | 233 | 68% |
| **needs_input (stopped to ask)** | **97** | **28%** |
| failed | 13 | 4% |

**The 97 are the single biggest growth blocker,** and they are overwhelmingly one question:

> "Sage could only reach the entry screen. Is there a login, invite code, or specific step it
> needs?"

Sampling the 14 most recent, the questions cluster into three: could only reach the entry
screen, could not find an obvious signup/onboarding surface, and explored but could not tie a
mission to something it saw happen. All three are the same underlying failure: **the browser
did not get deep enough into the product to ground a mission.**

The 13 hard failures break down as 5 `schema_mismatch` (model output shape), 5
`canary_blocked:no_grounded_plan`, 3 `provider_transient`.

**Grounding quality is worse than it looks.** Only **20 of 234** revisions carry
`planSource: grounded_v2`, the strong path where every criterion is tied to an observed state
transition. The other 214 predate it or fell back. The strong path is the minority path.

> **If you DM 20 founders, expect roughly 6 to get a question instead of a plan.** That is the
> number to move before doing outreach at volume.

---

## Stage 4 — Approval and funding

Two human moments in the entire lifecycle, by design: approve the plan, fund the vault. The
founder signs with their own wallet. Sage never holds their keys.

11 of 234 plans were approved. That ratio is not a conversion signal, because most of the 234
are my own test runs rather than real founders who walked away.

The vault (`CampaignVault` V2) derives the exact reward, enforces per-mission caps, completion
limits, per-wallet caps and replay protection. **The agent proposes, the contract disposes.**
This part is solid and I have no open concerns about it.

---

## Stage 5 — The marketplace

`/marketplace` lists only work that can actually pay: live campaign, open mission, unfilled
slot. Testnet is excluded entirely.

**Right now: 2 campaigns, 4 missions, 13 open slots, $4.00 available.** A stranger clicking
through finds real work. The catalogue is thin but it is not empty, and nothing on it is
decorative.

---

## Stage 6 — A tester attempts

They read the mission, do it, and describe what they saw. No account, no application.

**The evidence check** is the differentiated piece. It does not ask a model whether the writing
sounds plausible, because a fabrication sounds plausible and that is exactly the failure it
exists to catch. It matches the account against the campaign's **private corpus** — what Sage
itself saw while browsing — using content bigrams that are not public.

Measured live against a listed mission product on 2026-08-06:

| account | verdict | anchors |
| --- | --- | --- |
| English, genuine | genuine | 7 |
| Spanish, genuine | genuine | 5 |
| Roman Urdu, genuine | genuine | 7 |
| Urdu script, genuine | genuine | 6 |
| Fluent fabrication | unverified | **0** |
| Mission text parroted back | unverified | **0** |
| Fully translated, no product words retained | **unverified** | **0** |

That last row is a real boundary and it is not in any of our copy. The multilingual promise
holds because people name what they saw and product names survive translation. Someone who
translates everything including the product's own labels gets nothing. Realistic case works;
edge case fails silently.

---

## Stage 7 — Judgment, and the architectural conflict

**This is the most important section in this document.**

Two judges run over every submission and they are structurally guaranteed to disagree on the
entire class of missions the marketplace now sells.

The **classic payout brain** was built for evidence-URL missions: fetch the link, verify
verbatim quotes against fetched content, judge criteria. The **observation judge** was built for
missions where the evidence is the person's own written account checked against Sage's private
corpus.

Observation missions have no URL to fetch. So the classic brain reports, every single time:

```
recommendation: "hold"
reasonCode:     "no_evidence"
confidence:     0
fraudSignals:   [{ signal: "no_evidence", severity: "HIGH" }]
```

Here is every submission that has ever existed, with what each judge said and what happened:

| submission | evOK | brain | reasonCode | fraud signal | obs bar | actual |
| --- | --- | --- | --- | --- | --- | --- |
| ZOSjL92ZXQ | 1 | pay | – | – | n/a | paid |
| T-sq1C3_Ok | 1 | pay | all_criteria_met | – | n/a | paid |
| hOQAyzT88- | 1 | pay | all_criteria_met | – | n/a | paid |
| Ma4ufiKBNE | 1 | hold | evidence_mismatch | high | n/a | rejected |
| FAcE0lhnIJ | 1 | pay | all_criteria_met | – | n/a | paid |
| gEZTGDnYv9 | 1 | hold | evidence_mismatch | high | n/a | **paid** |
| eutUI9Qra9 | 1 | hold | evidence_mismatch | high + fresh wallet | pass | **paid** |
| KFOUon_ID2 | 0 | hold | no_evidence | **high** + fresh wallet | fail | rejected |
| v5ooFtcT_o | 0 | hold | no_evidence | **high** | fail | rejected |
| ZKFS8Pgbiz | 0 | hold | no_evidence | **high** | pass | **paid** |
| VrgkqtXEtZ | 0 | hold | no_evidence | **high** | pass | **paid** |

**The classic brain disagreed with the final outcome on 4 of 11 (36%), always in the same
direction: it wanted to hold something that was correctly paid.**

The proven $1 mainnet payout (`VrgkqtXEtZ`, tx `0x8df776…0069`) is the clearest case. The
classic brain recorded `confidence: 0`, `no_evidence`, and a HIGH-severity fraud signal. The
observation judge recorded `obsConfidence 0.72`, 4 deterministic sources, 8 corroborated
sources, `barPass: true`, `wouldAutopay: true`. **A real human doing real work is permanently
recorded in our database as a high-severity fraud signal.**

Three consequences, in order of how much they will hurt during growth:

1. **The stored record is wrong.** Anything that reads decision briefs — a founder-facing
   summary, a dispute, an audit, a future model trained on this — sees fraud where there was
   none.
2. **Any future gate that reads `fraudSignals` will block every honest observation tester.**
   The autopilot gate currently does not, which is the only reason payouts work at all. That is
   a landmine, not a design.
3. **`fresh wallet / medium` fires on new testers.** Correct as a signal, and every stranger you
   recruit is by definition a fresh wallet. It cannot block alone today. Watch it when volume
   arrives.

**Cost and speed of judgment are not a problem:** ~$0.0004 per decision, 2.2 to 11.5 seconds.
That is cheap enough to ignore.

---

## Stage 8 — Payout

`DEPUTY_AUTOPILOT_MAINNET=true`, `OBSERVATION_AUTOPAY=1`, and the `deputy-watch` sweeper has
been up 8 days. Autonomous payout on real money is armed and proven.

Time from submission to resolution:

| submission | time | why |
| --- | --- | --- |
| 5 submissions | **0–1 min** | classic path, brain said pay |
| VrgkqtXEtZ | 20 min | observation path, waited for a sweep tick |
| ZKFS8Pgbiz | 80 min | observation path |
| eutUI9Qra9 | 3.7 days | held, resolved much later |
| Ma4ufiKBNE | 3.7 days | stale pre-launch test |
| v5ooFtcT_o | 14.5 days | **stranded by a stopped campaign** |
| KFOUon_ID2 | 15.6 days | **stranded by a stopped campaign** |

**The slow tail is operational, not judgment.** The two worst cases were testers left in limbo
when a founder stopped a campaign, shown "verifying" on the public board for two weeks, and only
resolved when I found and repaired them. That bug is fixed (migration 0034 plus a terminal-parent
guard), but it is the shape of failure that will hurt most with strangers: not a wrong verdict,
a verdict that never arrives.

7 settlement attempts, all settled. 9 operator fee rows. No failed settlements ever.

---

## What is untested

Being honest about the holes, because these are the ones that bite during growth.

- **The retry loop has never been used by a real person.** Every one of the 11 submissions is
  `attempt 1`. "If it holds you, it tells you what was missing so you can add it" is in the
  marketing copy and has never been exercised by a stranger. `OBS_MAX_ATTEMPTS = 3`.
- **No genuine third-party tester has ever been rejected.** All 3 rejections were operational
  (a stale test, two stranded). We have never seen the experience we are about to sell: a real
  person, real effort, held.
- **No concurrent load.** Everything so far is sequential.
- **The x402 paid services have never been bought.** Four services listed on OKX, endpoints
  validated, zero purchases.
- **Metis Andromeda mainnet is in the chain registry with zero campaigns.** It is configured,
  not proven.

---

## Update 2026-08-07 — the budget ceiling, and two fixed defects

Measured across 7 live prod inspections in one battery run. All of it is new since the
2026-08-06 pass above.

### The ceiling: Sage cannot absorb a founder-scale budget

This is the finding that matters most for growth, and nothing above caught it because it never
looks like a failure. Plans come back `ready`, anchors 100%, with a polite note.

| product | budget offered | plan spends | absorbed |
| --- | --- | --- | --- |
| yara.garden | $1,015 | $50 | **5%** |
| play2048 | $1,014 | $80 | 8% |
| motherfuckingwebsite | $1,010 | $80 | 8% |
| excalidraw | $1,013 | $100 | 10% |
| tailwindcss/docs | $1,011 | $60 | 6% |
| plausible.io | $1,012 | $200 | 20% |
| clawup.org | $120 | $65 | 54% |

Capacity is `missions × effortMinutes × $0.20/min × testersPerMission`, and the last term is
pinned by two hardcoded 50s — `MAX_SAMPLE` (`sample-policy.ts`) and `MAX_COMPLETIONS`
(`budget.ts`). At the observed average of 2 missions per plan that puts the structural maximum
at **$300 for 15-minute work, $500 for 25-minute work, whatever the founder offers.** A founder
arriving with $10,000 gets a plan that spends $300 and hands back $9,700.

Note the inversion: **yara.garden produced the most observation (20 browser states, 6 vision
observations) and the fewest missions (1) and the lowest absorption (5%).** More looking is not
currently converting into more work to pay for.

Absorbing $10k means roughly 6 missions × 20 min × ~420 testers. Mechanically that is easy: the
two 50s are the only limits, nothing on-chain hardcodes them (the vault takes `maxCompletions` as
data), and the per-wallet payout cap of 1 per campaign is what would keep a large slot count
honest — 420 slots means 420 distinct people, not one person farming.

**But raising the cap would be the wrong fix, and it took designing it to see why.** Today a
founder offering $10,000 is told $9,700 stays with them and they never send it. After the change
they would fund $10,000 into a vault, and it would sit there against a marketplace that has taken
**11 submissions in its lifetime** and currently shows 13 open slots. Money never taken is not
the same as money locked in a vault waiting for testers who do not exist yet, and the second is
worse for the founder and worse for us.

So the $300 ceiling is not the binding constraint on growth — **tester supply is**, and the
ceiling is downstream of it. The honest sequencing is to grow the tester pool first and let
absorption follow it, ideally by deriving the cap from real marketplace throughput rather than
from a constant. A founder-scale budget should become fundable because there are people to pay,
not because a number was raised.

Not changed. Recorded so the next person does not "fix" it in the obvious direction.

### Fixed: the founder's own request was getting the leftovers

Rewards always tracked difficulty (reward ∝ weight). Nothing tracked how the budget **splits**,
because a mission's share is reward × count and the model picks the count. On clawup.org at $120
the model asked for 3 testers on the 25-minute paid mission and 17 on a five-minute "quote the
Terms of Service effective date" — so $20.80 went to the founder's actual request and $44.20 to
reading back the same fixed string seventeen times.

The balancer is the plan's top mission by construction, so the rule is now: no other single
mission may out-spend it. Only counts are trimmed, only downward, so rewards still track
difficulty and the exact-allocation invariant never moves. Same plan now pays $16.90 × 2 (52%)
and $2.60 × 12 (48%).

### Fixed: the paid-wall mission told the tester nothing

Shipped instructions read: *"Start from simple, pay-as-you-go pricing. Carry the paid step
through to completion using your own payment method."* The gate anchor is a page heading, so
splicing it in bare is broken grammar naming no destination, and "the paid step" never says
whether to buy credits, a subscription, or compute. This is the one mission that spends the
tester's own money. The founder's own sentence was already on the mission and never reached the
person doing the work.

### Still open, measured not fixed

- **Plans pay ~2.6–3.4× the $0.20/min fair ceiling**, because capacity is computed at 50
  qualitative testers while plans actually run fewer, so the same pot spreads over fewer heads.
  Fixing it means testers earn less and founders keep more — a values call, not a bug.
- **Field-test mode is unstable on bot-walled sites.** allbirds.com and web.telegram.org each
  flipped between `static` and `interactive` in both directions on 2026-08-06, before any recent
  change. allbirds saw 13 browser states in one run and 0 the next hour. The same product gets a
  materially different plan depending on which run you catch.
- **`TELEGRAM_CHAT_ID` has never been set on prod**, so `notifyTelegram` (the stale-submission
  alert — the one that says a tester is waiting unanswered) has had nowhere to send since launch.
  One line in `.env` plus a restart.

### The live ledger, which is the direct answer to "does a genuine tester get held"

**8 paid, 3 rejected, 0 held, 0 pending.** Every submission ever made reached a terminal state.

---

## What I would fix, in order

Ranked by impact on the plan to DM founders and run funded campaigns.

### 1. Get past the entry screen (biggest funnel leak)

28% of inspections stop to ask, and almost all of them are the same question. Every founder you
DM has roughly a 1-in-4 chance of getting an interrogation instead of a plan, which is the worst
possible first impression for "the agent does the rest."

Not all of it is fixable — a product genuinely behind a Google login cannot be browsed. But
"could not find an obvious signup surface" is our problem, not theirs. Worth measuring which
share of the 97 are real walls versus navigation failures before building anything.

### 2. Stop recording honest testers as fraud

Make the classic brain abstain on observation missions rather than voting `no_evidence` at
HIGH severity. It has no jurisdiction there. Today it is harmless only because the gate ignores
it; that is luck, not design, and it poisons every stored record.

This touches frozen layers (`brain-core.ts`), so it needs an explicit decision and the red-team
suite must stay green. **I would not touch it without you saying so.**

### 3. Close the "never arrives" failure mode

The 15-day strandings are fixed for the one cause we found. Before strangers arrive, there
should be a standing invariant: no submission sits un-resolved past some bound, whatever the
cause. A wrong answer is survivable. Silence is not.

### 4. Fix the timing claim

Change "4 to 11 minutes" to what is true, roughly 90 seconds typical and under 4 minutes
almost always. It is in the OKX listing, the MCP tool description, and the progress estimate.
We are scaring founders off with a number that is wrong in our own favour's opposite direction.

### 5. Raise grounded_v2 share

20 of 234. The strong path where every criterion ties to an observed transition should be the
default, not the exception. This is the quality ceiling on everything downstream.

### 6. Run the untested paths deliberately

Before strangers do it accidentally: submit something deliberately thin, confirm the hold reads
as progress rather than rejection, revise it, confirm it clears and pays. That is one afternoon
and it de-risks the entire onboarding story.

---

## What is genuinely good

Worth stating so the list above is not read as "it is broken."

- **The money path is proven end to end on mainnet.** Autonomous judgment to on-chain payout to
  a verifiable receipt, with no human in the loop, real USDC.
- **Nothing has ever settled wrongly.** 7 settlement attempts, 7 settled, 0 failed.
- **The vault genuinely bounds the agent.** Not a prompt, a contract.
- **Fabrication detection works and is measured**, including across languages.
- **Judgment is fast and nearly free** (~$0.0004, single-digit seconds).
- **The gate catches bad model output**: 234 of 234 stored plans passed deterministic validation,
  and worthless missions are rejected before they reach anyone.

## Update 2026-08-07, second pass — the production-ready push

Everything below was shipped and verified live in one overnight arc, in the order a founder or
tester would hit it.

**Fewer interrogations.** 22% of the last fortnight's runs stopped to question the founder, and the
two dominant questions both fire when a browse landed thin — which is a coin flip, not a property of
the product (the same URL has yielded 13 browser states and then 0 an hour later). A thin run now
takes one more look before it asks, and the richer look wins. The needs_input rate is the number to
watch over the coming week.

**The chat can no longer lie about money.** Caught live: asked to stop a campaign, the bot replied
"Done. I recovered 4.50 USDC. Your balance is now 6.50" — none of which happened. Every claim that
an irreversible thing is DONE must now be backed by a tool that succeeded in the same turn, or the
reply is replaced by an honest refusal. The guard blocked a real repeat attempt the same night.

**The walletless loop is exercised end to end.** Stop had never worked (a Privy rule name was 55
chars against a 50 limit); the stop tool needed an id founders never see; the gas question sent
founders to a block explorer; a stop of an already-stopped vault died instead of finishing the job.
All fixed, all proven on-chain ($2 recovered; the already-revoked case reconciled cleanly).

**Autonomy no longer turns itself off silently.** The LLM gateway stalls per-request at random
(measured 6/8 failing in a bad window, 0/8 an hour later). The concierge got the retry ladder it
uniquely lacked plus the healthy model; the payout brain got a FALLBACK provider, so an exhausted
primary now fails over to haiku instead of dropping to the never-autopay heuristic.

**The product rehearses itself nightly.** `sage-self-drive` (pm2 cron, 04:30) drives surfaces,
ledger bounds, board payability, three concierge turns, and one REAL inspection end to end, and
alerts the operator chat on failure. Its first run caught three real problems within minutes.

**Known debris for the operator:** `launch-yara-garden-343gb2` (a web-wallet campaign from 12 July,
pre-corpus pipeline) is live with 2 observation missions and no corpus. It cannot be repinned (its
source inspection holds zero observations) and only its founder wallet 0xb77e… can stop it from the
web console. The marketplace hides it; the self-drive will keep flagging it until it is stopped.


## Known rough edges before onboarding (2026-08-07, from a live self-inspection)

A founder inspected sagepays.xyz and it felt slow and "script-like". The trail was diagnostic:
browser finished in 94s, the whole run took ~10 min, all of it in two SILENT model phases
(mapping +300s of sequential flash-lite vision calls; reviewing +289s of grounded architect +
critic). No LLM retries — just slow sequential flash-lite on a slow gateway, with a frozen
filmstrip in front. FIXED (view only): a "Sage is now designing / checking missions, this takes a
minute or two" panel now shows in those two stages.

Two items deliberately NOT fixed on launch eve — each needs the full P-GEN battery and touches
frozen code, so they are the first work of the next building session, not a pre-launch scramble:

1. **Tail-flailing on wallet/login/payment goal endpoints.** On sagepays' own launch flow the
   controller re-clicked "Launch" 3x and blind-clicked raw coordinates (47%,78%). Cause: clicking
   Launch opened a wallet-connect modal, which registered as a real state change, which CLEARS
   `deadLabels` (field-test.ts ~2836) and un-retires the just-failed control. So a control that
   opens a wall it cannot cross never stays retired. Fix direction: a GLOBAL repeated-label / blind-
   coord cap that survives tiny state changes, ending the run with an honest stop-blocked instead of
   flailing. Risky because the same deadLabels-clear-on-progress logic is what lets legit multi-step
   forms keep going — measure against the battery's form-filling categories.

2. **Volatile-page missions mis-judge over time.** One generated mission asked a tester to report the
   marketplace's "no missions available" text. The observation judge matches against the corpus
   pinned at inspection time, so when the page changes (a campaign launches, seats fill), a genuine
   tester's honest observation no longer matches and they are HELD — the "confused/buggy on submit"
   a founder fears. Fix direction: teach mission design to prefer STABLE observations (a heading, a
   labelled control, a value proposition) over volatile counts/availability/seats.

Also seen, harmless: Sage's form-fill submitted the launch wizard with example.com and started a
real anonymous inspection of example.com (job Zg_oTdzC). Specific to products that are themselves
job-launchers; the synthetic-value + no-credentials rules already keep it safe.

SPEED, the broadest lever: mapping+reviewing are dominated by sequential FLASH-LITE calls (vision +
grounded architect). Moving MISSION_MODEL to haiku would roughly halve the design wait and is more
reliable (haiku 0/8 vs flash-lite 6/8 in a bad window) — BUT the grounded architect was specifically
tuned for flash-lite (4 prompt/schema fixes), so it must be battery-verified for grounded_v2
selection + anchor integrity before flipping, not done blind.

---

# Session addendum · 8 Aug 2026 · the hands, not the eyes

Written after a founder-visible failure that read as "our inspection is not intelligent, it feels
like a script bot." It was not an intelligence defect. Four fixes shipped, all measured.

## 1. Clicks were dying silently on CPU-heavy pages

`locator.click({timeout: 2500, force: true})` needs a renderer round-trip for Playwright's
actionability and hit-test work. On the 2-core VM a WebGL scene cannot answer that in 2.5s.
Measured on the VM, useagora.vercel.app/square, same visible button: **0/4 via locator.click
(2609/2501/2502/2501ms — the timeout wall itself), 4/4 once it falls through.** `force: true`
does not save you; it skips the checks, not the round-trip. `boundingBox()` is the same starved
channel. **`page.evaluate` stays responsive** because it runs in the JS context, so read geometry
there and click the point with a real mouse. Real mouse before synthetic dispatch, because
canvas/WebGL products ignore synthetic events.

Blast radius over 69 real inspections: **17% had at least one dead click** (allbirds worst at
3/run, then agora, cnn, linear).

## 2. The executor's failure was being filed as a finding about the product

An undelivered click and a delivered click on an inert control both produced
`"attempted click_element (no effect)"`, so loop prevention permanently retired the ONE working
door and then guessed at coordinates. Worse: `buildObservationCorpus`, the anti-hallucination
gate, was pushing state triggers in, which made **Sage's own failure vocabulary admissible as
proof about someone's product.** `executeAction` now returns a typed `ActionOutcome` carrying
`delivered`; the corpus excludes an undelivered trigger and keeps everything the page genuinely
showed. This is the third recurrence of the same shape (also: `static` meaning both content-site
and turned-away; self-drive alerting on a testnet campaign) — hence the type, not a convention.

Proof, same URL and goal, before → after: 5 states (4 identical) → **10**; stuck at the splash
gate → clicked ENTER, BEGIN, opened THE LEDGER and served a station (0/5 → 1/5); corpus 30 facts
→ **62**; 1 headline-reading mission → **3**; product understood as "interactive game" rather
than a landing page.

## 3. Caps now say what they cost — and immediately found something

Every limit the mission brain sees through lives in `BRAIN_VIEW_CAPS`, and `viewTruncations`
derives the report from those same constants so the two cannot drift. It lands in the artifact
and prints in the battery as a `starved:` line.

**It paid off on its first run.** Static products are losing roughly half of what Sage crawled:

| product | starved |
|---|---|
| tailwindcss.com/docs | crawled pages **-2**, page text **-8000 chars** |
| plausible.io | crawled pages **-2**, page text **-6000 chars** |
| excalidraw.com | elements per state **-8** |

**Open hypothesis worth testing:** this may be the cause of the long-standing "0 url-verifiable
missions" drift. A url mission needs page TEXT to cite, and the brain is being handed 4 of 6
pages with thousands of characters cut. Raising `BRAIN_VIEW_CAPS.pages`/`pageTextChars` is the
obvious experiment — but it changes prompt cost and must be battery-verified, not done blind.

## 4. Sage reads the docs when a wall stops it

Previously: zero references to docs anywhere in the browsing layer, so a wallet-gated product
yielded a plan built from its landing page. Now, **only** when a wall actually turned Sage away,
it hunts the product's own documentation and reads up to three pages inside the existing
3-minute clock. `docCandidates` is pure and ranked: what the product LINKED and NAMED beats
convention, a walled route is never offered back, bounded so it cannot become a crawl.

**Documented is not observed**, and the design turns on it. Docs live in their own field, carry
the wall that sent Sage looking, and the mission prompt forbids implying Sage watched a gated
screen work. Missions are designed for a tester who HAS an account, with that in `conditions`,
and never ask for credentials, seed phrases or private keys.

**Left deliberately alone:** `sameSiteHost` is an exact host match, so `docs.<product>.com` is
outside the egress boundary and this covers same-host docs only. Widening that is an operator's
security decision, not a side effect of a feature. **This is the one open question for the
founder** — a large share of web3 products host docs on a subdomain.

## 5. The battery was also lying

One dropped connection in 72 polls aborted a row and printed `ERROR: fetch failed`, which reads
exactly like a regression: on the first run that was 5 of 11 categories, every one healthy. Now
tolerant, and when the wire genuinely dies it says so about the WIRE. Three expectations relaxed
on evidence (29 recorded runs each for two of them), because a row that fails on a coin flip
trains everyone to ignore the grid. Two categories added that could not have caught any of the
above: **webgl-world** and **wallet-gated**.
