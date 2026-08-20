# Seed User Validation Report

*Sage · OpenClaw Summer Builder Bootcamp · Stage 2*

## Seed users: 20

Twenty people did paid testing work across our two campaigns, with no overlap between them — every
tester in one is a different person from every tester in the other. A further thirteen people left
written feedback through the product's feedback panel.

| Campaign | Testers | Paid | Reward | Settled |
|---|---|---|---|---|
| **clawup.org** | 6 (8 reports) | 4 | $5.26 | $21.05 |
| **sagepays.xyz** | 14 | 10 | $2.50 | $25.00 |

## What the testers did

**On ClawUp**, each tester signed up, got through email verification, created a working agent, and
connected a live messaging channel to it. These were not view-a-page tasks — completing one required
a real account and a deployed agent, which is why their reports contain details only someone who did
it would know.

**On Sage**, each tester ran a real inspection on a product of their own choosing and reported what
they saw. Ten were paid within forty-five minutes of the campaign opening.

## Key insights

**Testers will do careful work for small, real money.** Ten strangers wrote detailed accounts for
$2.50. The reward being real and provable mattered more than the reward being large.

**Real users find what code review cannot.** Two testers independently reported an inspection
failing with "the reviewer returned an unusable response." The cause was a planner that had been
dead for two days behind a green test suite.

**Feedback arrives as the work, not as a reply.** Nobody answered our request for feedback after
being paid, and we wrongly concluded paid testers won't give it. It had been inside their
submissions all along. We had never built the screen that showed a founder what the people they paid
had written.

**Honest refusal text turns a dead end into a relationship.** Rewriting refusals to name the real
cause and say plainly "this is not a judgement on your work" was the cheapest trust improvement we
made all of Stage 2.

## The original assumptions, tested

| We assumed | Result |
|---|---|
| Testers want small, fast, real USDC over points | **Confirmed** — 20 testers, 16 paid, no paid acquisition |
| Founders get verified evidence rather than noise | **Confirmed** — 48% of submissions refused, every payout cites its evidence |
| They are reachable through builder communities | **Confirmed** — both campaigns filled from existing communities |
| The public proof receipt acts as the referral | **Partly** — receipts are public and shared, but we never instrumented attribution |
| Founders will fund because they never hand over keys | **Unproven** — the mechanism works end to end; no outside founder has funded yet |

## What we changed because of users

| What a user hit | What we shipped |
|---|---|
| "The reviewer returned an unusable response" | Fixed the parser that was rejecting valid model replies |
| Four testers waiting forever on a campaign that had ended | Terminal campaigns now close every submission with an honest written reason |
| Submissions to missions whose slots were already gone | The slot check runs before judging, and a retry now holds the tester's place |
| 239 notifications fired for four submissions | A hold is a state, not an event |
| A $5 campaign paid one tester and stranded the rest | A $0.50 reward floor, so a small budget pays several people |
| Founders could not see what their testers wrote | The founder console is now the tester reports |

Nine user-reported defects were fixed during Stage 2. Four remain open and are listed publicly
rather than quietly closed.

## Evidence

- Every word our users wrote, verbatim: [feedback log](https://github.com/shariqazeem/sage/blob/main/docs/stage2/feedback-log.md)
- Full validation detail, per campaign: [seed user validation](https://github.com/shariqazeem/sage/blob/main/docs/stage2/seed-user-validation.md)
- Published case study: https://sagepays.xyz/case-studies/autonomous-paid-testing
- How it works, architecture and safety model: https://sagepays.xyz/docs
- Public campaign boards: https://sagepays.xyz/c/launch-clawup-org-tf62c8 · https://sagepays.xyz/c/launch-sagepays-xyz-w6ynbw
