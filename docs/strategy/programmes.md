# Programmes — one template, many recipients (a scoped design, 5 Sep 2026)

**Who it is for.** An incubator paying a cohort's milestones, an export agency paying MSMEs for
verified deliveries, a diaspora fund backing twenty sellers. FC's bar names it: "integrates with
lenders and financial institutions", "systems that move capital".

**What exists.** The deterministic direct compiler (`compileDirectCampaign`) turns one sentence plus
amounts into an approved plan; the treasury launch (`POST /api/launch/<id>/treasury`) deploys, funds
and activates an approved plan from the founder's treasury inside the mandate; recipients are invited
by one-time Telegram links (`recipient-onboarding.ts`) and workspaces by `/join` links; every payout
lands on a record a lender can read.

**The feature.** `/workspace/programmes`: paste rows (name · wallet or "invite" · amount · currency),
write the template once ("J$5,000 when the catalogue page is online, J$5,000 on the first review"),
and Sage compiles one plan per row — same compiler, same lint, same denomination stamp — then
"Launch all from the treasury" runs the existing treasury launch per plan, in order, inside the
weekly and per-campaign ceilings. Rows marked "invite" get a one-time recipient link to send by any
channel. The programme page then shows every campaign's state, payouts and records in one table.

**Effort.** One route (`POST /api/programmes` → N `CreateDirectResult`s), one page, a
`programmes` table (id, founder, title, rows, plan ids), tests on the row→plan mapping and on the
ceilings refusing the (N+1)th launch. About a day with the money path exercised on a funded treasury.

**Why not tonight.** It moves money N times from one click; it needs the founder's eyes on the
first funded run, and the deadline days are for the video and the proof run, not for a new money
surface shipped blind.
