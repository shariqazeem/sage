# Brief: make Sage's agent worth relying on

You are working in the Sage repository. Your job is to find what is wrong with the agentic
system and fix it, end to end, with your own judgement about what matters most.

**Read `docs/FOUNDER-BRIEF.md` first.** That is the founder's own statement of what the agent has
to be, and it is the standard every change is judged against. Then `CLAUDE.md` for the product and
the architecture.

This document is the part that is in neither: how to measure what the system actually does, what
will destroy it if you break it, and the specific traps that have already cost days.

---

## 1. The bar

A founder with real money and real users should be able to hand Sage a URL, a goal and a budget
and trust the result without supervision. Concretely, and these are the sentences to hold
yourself to:

- **Any product.** A marketing page, a canvas game, a login-walled SaaS, a docs site, a
  non-English site, a bot-walled store. Not a family of products Sage happens to handle.
- **Any budget.** $10 and $50,000 must both produce a sane plan. Neither "we cannot fund a
  sample" nor one person collecting sixteen thousand dollars for five minutes of work.
- **Missions from what Sage actually saw**, sized so the reward matches the effort, and covering
  what the founder asked for rather than whatever was easiest to observe.
- **Payouts a stranger can trust.** Someone who genuinely did the work gets paid, including a
  beginner writing rough English or their own language. Someone who did not gets nothing. The
  same submission must get the same verdict every time.
- **Identical behaviour from Telegram and web.** Same engine, same quality. A founder must not
  get a worse plan because of which door they came through.

Sage's own principle, from `CLAUDE.md`: **the LLM proposes, the vault disposes.** No model output
may ever be the sole basis for moving money.

---

## 2. How to find things: measure, do not reason

Every defect worth finding in this system was invisible in a code review and obvious in
production data. Reading the code tells you what it intends. These tell you what it does.

### The production database

Read-only, over SSH. This is the highest-value instrument in the repo.

```bash
ssh -i ~/.ssh/sage-deploy.key ubuntu@80.225.209.190 \
  'cd /home/ubuntu/sage && node -e "
    const D=require(\"better-sqlite3\");
    const db=new D(\"var/sage.db\",{readonly:true});
    console.log(db.prepare(\"select ...\").all());
  "'
```

Tables that answer real questions: `inspection_jobs` (status, `pages_inspected`, and a `result`
JSON holding the whole map, journey, canary decision and plan), `plan_revisions`
(`grounded_provenance`), `campaigns` (`private_corpus`), `missions`, `submissions`, `decisions`
(`brief`, `observation_shadow`), `events`.

### The generalization battery, P-GEN

Eleven real, live products through the whole pipeline. **Run it before you believe any change to
browsing, missions or the gates.** It caught two of the last round's three self-inflicted
regressions.

```bash
node scripts/mission-eval-matrix.mjs --base https://sagepays.xyz --nonce 12
```

`--nonce N` sets each budget to `10 + i + N*100`, so a large nonce overflows the reward cap and
every row errors before any inspection runs. Anchor integrity below 100% is a hard stop.

### The payout drill

The whole hold, coach, revise, clear loop against a real live-campaign corpus with a real judge
and no money involved.

```bash
npm run drill:payout
```

### Live probes

`npm run okx:watch` (listing plus endpoint health), `npm run x402:merchant` (payment rail), and
plain `curl` against `https://sagepays.xyz`. The nginx access log on the VM
(`sudo grep /mcp/ /var/log/nginx/access.log`) is the only way to see what an external reviewer or
agent actually did.

### Writing a throwaway probe

Often the fastest way to answer "does this function really do that" is a temporary vitest file
that calls the real code path, run once, then deleted. Do this instead of reasoning about it. It
is how the anchor floor was found to be dead.

---

## 3. What must not break

Treat these as load-bearing. Changing them can silently unbound money.

- **`brain-core.ts`**: `SYSTEM_PROMPT`, `detectInjection`, `hardenBrief`. Frozen. The red-team
  suite (`tests/redteam/`) guards them and must stay green.
- **`autopilotGate`** in `autopilot.ts`, the mandate builder in `privy/mandate.ts`, the vault ABIs
  and `settle-flow.ts`.
- **Budget exactness**: `Σ(rewardBase × maxCompletions) === totalBudgetBase` to the base unit.
  `budget.test.ts` fuzzes 4,000 plans against this.
- **The anchor floor** in `observation-verify.ts`. An account with no deterministic match and no
  product phrase must never pay, no matter what the model says.
- **No corpus oracle**: never expose pre-submission feedback derived from corpus matching. An
  attacker who can query the matcher reads the answer key off it. Feedback exists only after a
  judged submission, bounded by `OBS_MAX_ATTEMPTS`.

Gates before shipping: `npm run lint`, `npm run typecheck`, `npx vitest run`. Strict TypeScript,
no `any`, no `@ts-ignore`.

---

## 4. Traps that have already cost days

These are not hypothetical. Each one shipped, and each cost real time to find.

**An optional signal field is a trapdoor.** `observationBar` applies the anchor floor only when
`deterministicSources` is supplied, so a caller that stops supplying it disarms the gate in
silence and TypeScript cannot see it. A refactor did exactly that, and three model-bridged
corroborations alone could then trigger an autopay. **Test through the real caller, not the pure
function.**

**A guard on the happy path is not a guard.** An over-funding check written at the bottom of the
plural-sample path was skipped by two earlier returns. Wrap every exit, or it does not exist.

**Review incoming work for what it REMOVED.** The last external round silently reverted a browser
fix and deleted a payout guard. Both type-checked, the full suite stayed green, and neither was
mentioned in its handoff. Read `git diff` minus-lines in files the handoff did not claim to touch,
first.

**Validate the instrument before believing it.** This has now caused four wrong conclusions:
`getMerchant()` called without its argument returned an empty object that read as "no config";
a portal host answered 200 with HTML for every API path, so a wrong hostname looked exactly like
an unconfigured merchant; a local battery run was reported as a regression when the sites were
simply WAF-blocked; and a payout drill that omitted the criterion contract made a passing account
look held, nearly prompting a loosened bar.

**`grounded_provenance` NULL does not mean the shadow never ran.** That column is only written
when the canary SELECTS. The real state is `result.canary.status` and `.reason`.

**Browsing is not deterministic.** The same URL and goal has produced anywhere from 0 to 36
browser states and 0 to 301 observed facts across runs. One run proves nothing. Compare
distributions, not single runs.

**Shell exit codes lie in pipelines.** `cmd | grep ...` reports grep's status. More than one
"green" gate this session was actually red.

---

## 5. Where the system stands, measured today

387 inspections: 269 ready, **102 needs_input**, 13 failed. 13 campaigns, 16 missions, 11
submissions ever, 8 paid. P-GEN currently 11 of 11 ready with anchor integrity 100%.

Known-open, in rough order of value:

1. **102 of 387 inspections stop to ask the founder something.** Most say some version of "Sage
   could only reach the entry screen". This is the biggest single barrier to onboarding founders.
2. **21 of 270 plan revisions are `grounded_v2`.** The strong path where every criterion ties to
   an observed transition is still the minority path. Anonymous jobs can never reach it by design;
   whether that is right is worth questioning.
3. **Zero of 16 missions carry a compiler-authored criterion contract.** Only the grounded path
   produces one, so the criteria-complete pass runs on a derived contract everywhere in
   production.
4. **A long landing page is only partly read.** ClawUp's homepage has a full pricing section with
   "Buy token credits" and "$20 per agent / month"; Sage's corpus contained "pricing" and
   "pay-as-you-go" but not "token credits", "buy token" or "per agent". Content below the fold is
   being missed, which starves everything downstream.
5. **The gated-action mission** (`gated-action-mission.ts`) builds a mission for a paid or
   account-gated step the founder explicitly asked for, but only when Sage can anchor on a
   doorway it actually saw. On a product whose entire flow is behind a login it correctly stays
   silent, and the founder gets the observed-part plan plus an honest ask for a demo account.
   Whether that is the best possible answer is open.
6. **11 submissions is not a dataset.** No genuine third-party tester has ever been rejected or
   used the retry loop. Every submission is attempt 1.

---

## 6. How to work

Pick what matters most yourself. The list above is evidence, not a work order.

- **Measure first, then change.** State the number before and after. "It feels better" is not a
  result.
- **Fix causes, not symptoms.** A mission about a logo page was not a mission-brain problem; four
  logo SVGs had eaten the page budget.
- **Say when you are unsure.** A finding you could not confirm is still worth reporting, labelled
  as unconfirmed. Do not round it up.
- **Comment the why, not the what.** The comments in this repo record what was measured and what
  broke. Match that.
- **No em dashes in user-facing copy.**

## 7. What to hand back

A handoff naming, for each change: the file, what it does, and **the measurement that justifies
it**. Explicitly list anything you removed or reverted, and anything you tried that did not work.

Do not deploy. Deployment runs from the other session, which holds the prod discipline and the
history. Hand back the diff, the reasoning and the numbers, and note any test result you want
re-run independently.
