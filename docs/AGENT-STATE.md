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
