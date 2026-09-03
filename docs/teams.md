# Sage for teams — the closed loop

> Decided 2026-09-04 after the first Starknet gig was farmed 10/10 by one operator (see
> `docs/execution-plan.md`, findings 27–29). Open public bounties drain; the engine — verify the
> work, pay inside on-chain limits, publish a receipt — is what organizations pay for.

**The loop in one sentence.** An organization sets a budget, invites its people, states the work;
Sage verifies delivery and pays inside on-chain limits (privately on Starknet when they want it);
every payout builds the recipient's record; the record unlocks capital.

## What exists (live at sagepays.xyz)

| Piece | Where | Notes |
| --- | --- | --- |
| Sign-in | `/start`, `/join/<code>` | "Continue with email" (Privy: an embedded wallet Sage keeps for the person; the server verifies Privy's token and mints the same session) or a wallet you already have (Ethereum or Starknet). |
| Onboarding | `/start` | Sign in → what you are here for → name a workspace or join one. The only door from the landing. |
| Capital | `/workspace/capital` | The FC package from inside: paid on verified work, receipts, people paid with clusters collapsed, each earner's record, the lender view, outcomes, the explorer, the advance facility. |
| Workspace | `/workspace` | Owner view: work, members + invite links, plan, Sage's recent work. Member view: open work, own status, record. First visit: name it, or paste an invite. |
| Invites | `/join/<code>` · Telegram `/start ws_inv_<code>` | A wallet link, or a Telegram link that mints the member a Sage wallet (no app, no seed phrase). |
| Scope | `campaignWorkspace()` | A founder's campaigns belong to their workspace from every door (web, Telegram, MCP). Column `campaigns.workspace_id` for the future. |
| Members-only work | submit route | An **unlisted** workspace campaign accepts submissions from members only; a stranger is told whose door it is. Listed = open. |
| Plans | `src/lib/workspaces/plan.ts` | Free: owner + 2 members, every lane, public receipts. Pro: unlimited members, private payouts on Starknet, working-capital advances. `SAGE_PRO_PRICE_USD` (default 29). |
| Pro payment | `/api/workspaces/plan` | One USDC transfer on GOAT from the owner's wallet to the operator; Sage reads the receipt (`findUsdcPayment`) and extends 30 days; a hash is spent once (`workspace_payments`). |
| Notifications | `workspace-notify.ts` | The moment a workspace campaign goes live, members reachable on Telegram are told, with the link. |

## How a team uses it

1. Sign in at `/workspace` (Ethereum or Starknet wallet — a free signature). Name the workspace.
2. **Invite people**: copy the web link or the Telegram link. Free holds three members; the fourth asks for Pro.
3. **Post work** from `/launch` (pay mode): a gig, milestone grant, or testing run. Tick *invite-only* to keep it members-only.
4. Members see it on their `/workspace` (and on Telegram), do it, submit the link. Sage verifies against the brief, the deterministic gates (durable host, own words, word floor, copy and Sybil checks) and pays inside the vault's limits. Held or refused work shows the reason and the revise path.
5. Every payout is a receipt; every recipient's record grows at `/record/<wallet>`; on Pro, a member can take a self-serve advance against verified inflow.

## Public campaigns, from inside

The public board is still a door — from inside the workspace, not instead of it. A team that wants
strangers (a testing run, an open bounty) unticks *invite-only* and the campaign lists on the
marketplace. What changes is who decides: on a **members-only** campaign Sage pays automatically
inside the vault's limits; on a **public** campaign Sage still does every check — the brief, the
deterministic gates, copies, wallet clusters, author-account age, pace — and then **the team
releases each payout** from the console with Sage's assessment beside it. The agent filters; the
organization decides. Sybil detection keeps improving under the same batteries, and the judge is
promotion-gated on them.

## Why this is the FC story

The track asks for infrastructure that moves money for MSMEs, judged by people from verified-repayment
finance. A program, cooperative, incubator or company pays known people for verified work through
Sage; the payouts are the credit record; the record unlocks working capital. Identity is known by
construction, so the AI's job is the one it is measurably good at: was the work done.

## Next

- Org accounts with roles and recurring budgets; several workspaces per founder.
- Pro paid from a Starknet wallet (today: GOAT USDC).
- Dogfood: the Sage workspace with known members; one private Starknet payout on the fixed route.
- Landing and docs reframed around the loop; pricing page.
