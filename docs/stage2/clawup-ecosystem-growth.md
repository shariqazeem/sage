# Sage — ClawUp Ecosystem Growth Report

*OpenClaw Summer Builder Bootcamp · Stage 2 · compiled 19 Aug 2026*

What Sage contributed to the ClawUp ecosystem during Stage 2, and the evidence for each claim.
Every payout below is a transaction on GOAT Mainnet that can be verified without our cooperation.

---

## Summary

| Contribution | Measure |
|---|---|
| **Real users driven onto ClawUp** | **6 people** — each signed up, created a working agent, and connected a live messaging channel |
| **USDC we paid them to do it** | **$21.05** across 4 verified completions |
| Mission reports filed on ClawUp workflows | **8** |
| ClawUp product issues surfaced by those testers | **3**, with verbatim evidence |
| Sage's MCP server submitted to the ClawUp Marketplace | Built, **7/7 conformance**, blocked by a ClawUp-side HTTP 500 we reported |
| #ClawToTheTop growth challenge | **2nd place cohort-wide** (10–14 Aug) |
| Public content about ClawUp | Case study post, **1,668 impressions** |

**The distinguishing fact:** we did not just refer users to ClawUp — we *paid them in real USDC* to
complete real ClawUp workflows, and we have their written reports and on-chain receipts proving
they did. Every one of those six people ended the session with a working ClawUp agent connected to
a live messaging channel.

---

## 1. The paid ClawUp campaign

`launch-clawup-org-tf62c8` · GOAT Mainnet · vault
[`0xa3BFc35a…1537`](https://explorer.goat.network/address/0xa3BFc35a5eB2c1B52Ee9dcCb84d9a80380211537)
· public board `https://sagepays.xyz/c/launch-clawup-org-tf62c8`

| | |
|---|---|
| Window | 14 Aug 2026, 05:34 → 07:23 UTC |
| Distinct testers | **6** |
| Mission reports filed | **8** |
| Paid | **4** |
| Reward per completion | $5.263165 USDC |
| **Total settled** | **$21.05 USDC** |

### The two missions

**1. Create Your First ClawUp Agent and Chat With It** — the tester had to sign up, get through
email verification, create an agent, and hold a real conversation with it.

**2. Connect a Messaging Channel to a Fresh Agent** — the tester had to take a newly created agent
and connect Telegram, Feishu, or Slack to it, through to a confirmed live connection.

These are not view-a-page missions. Completing either one requires a working ClawUp account and a
deployed agent, which is why the reports below contain details that could only come from having
actually done it.

### What the testers reported

> "The code verification [was] very fast, only about 1 sec to 3 sec… Agent and Account section like
> this: Agents, Teams, Tools, Identity, Billing, APIs, Audits, Quests, Referral"
> — `0x181B4A…515C`

> "Navigation tools like before the header, after that name field and the type agent openclaw or
> Hermes Agent, and I try default and create agent only about 120s — that['s] quite fast, very
> lovely and even faster than expected"
> — `0x1Dc38C…DF1F` ·
> [proof](https://sagepays.xyz/proof/0x39a40e727e6cae70c9c66071ebbce827d3effa48ca4dcfa8feff612f9cfcb4ee)

> "After creating your agent in ClawUp, that section is called 'Channel' (optional)… There are 3
> options: Telegram asks for a Bot Token, Feishu asks for App ID + App Secret, Slack asks for Bot
> Token (xoxb-…) + App Token (xapp-…). Done: 'your Telegram channel is now connected! ✅'"
> — `0x9f5E1a…0f39` ·
> [proof](https://sagepays.xyz/proof/0xc1f0319ce64a650b146b0c66c4a59266da19d5ec53ca5a0c58f450075092d3a5)

> "Status deployment: creating → reconciling → running. Bot gives a pairing code: 'Ask the bot owner
> to approve with: openclaw pairing approve telegram XXXXXXX'. After the code is sent to the agent
> via Open Agent Chat, the agent replies: 'Telegram has been approved'."
> — `0x1Dc38C…DF1F`

> "When I create my agent on ClawUp, there's this little section called Channel… I've got three
> channel options to pick from. If I go with Telegram, I just drop in one bot token from BotFather."
> — `0x9F9D38…2560` ·
> [proof](https://sagepays.xyz/proof/0xc19da3d24df06a604346f69c3e9e9fb8fa5842b4902220fb2683cdeb103db86b)

Reports were filed in English and Indonesian — the testers came from genuinely different places,
not one group. Complete verbatim log: [`feedback-log.md`](./feedback-log.md).

### ClawUp product issues these testers surfaced

Real user testing produces findings for the *tested* product, not only the testing product. Three
came back about ClawUp itself:

| Observation | Verbatim |
|---|---|
| The verification-code button gives no countdown feedback — it changes to "sending…" and then reverts, with no timer, so a user cannot tell whether a resend is pending | *"it's clicked but not change to 59s or anything, but after clicked it's change to sending… after that back to the send code"* |
| Agent creation takes ~120 seconds with the default settings — fast, but long enough that the wait needs a progress signal | *"create agent only about 120s"* |
| The channel-connection flow spans three surfaces (agent chat, the bot, the CLI pairing approve command) — completable, but the pairing step is the one users describe at greatest length | *"Ask the bot owner to approve with: `openclaw pairing approve telegram XXXXXXX`"* |

These are offered as usable feedback for the ClawUp team, not as criticism. All three were surfaced
by people who had never used ClawUp before that day.

---

## 2. Sage's MCP server for the ClawUp Marketplace

Sage built and shipped an MCP server so that any ClawUp agent could use Sage as a tool.

- **Endpoint:** `https://sagepays.xyz/mcp`, built on the official
  `@modelcontextprotocol/sdk` stateless Streamable-HTTP transport.
- **Five read/inspection tools:** `sage_start_inspection`, `sage_get_inspection`,
  `sage_get_campaign`, `sage_get_submission`, `sage_get_proof`.
- **Provably cannot move money.** A structural test gate (`agent-api.test.ts`) fails the build if a
  signing or settlement capability is ever exposed through MCP.
- **Conformance 7/7** against the official SDK client, run from outside the app process against the
  live endpoint (`scripts/mcp-conformance.mjs`).

**Status: blocked on the ClawUp side, and reported.** `POST
https://clawup.org/api/v1/agents/{agentId}/tools/{name}` returned HTTP 500 during "Validate &
Install" — reproduced against **Sage and unrelated public Marketplace tools**, with our server logs
showing `clawup-validator/1.0.0` connecting successfully to a healthy endpoint. We reported it
rather than claiming the integration works. Full record: [`../CLAWUP_INTEGRATION.md`](../CLAWUP_INTEGRATION.md).

We do not claim "Sage works inside ClawUp." We claim we built the integration to spec, proved our
side healthy, and gave the ClawUp team a reproducible platform bug.

---

## 3. Sage used ClawUp itself

Before designing the campaign, Sage signed into the ClawUp console with its own dedicated test
account — password entry, emailed verification code, and all — then created an agent and interacted
with it. The missions above were designed from that real observed workflow, not from ClawUp's
marketing pages.

This matters for one reason: **the missions were answerable.** Every mission Sage published could
be completed and verified because Sage had already walked the path itself.

---

## 4. Growth challenge and public content

**#ClawToTheTop, 10–14 Aug — 2nd place cohort-wide.** A bootcamp-wide challenge scoring promotion,
reaching real users, and public visibility, judged by the organizers.

**Case study post, 14 Aug** —
[*"An AI agent needed 4 strangers to test @ClawUpAI, so we gave it $20 USDC"*](https://x.com/sagepaysai/status/2088010924422750314)
· **1,668 impressions**, with the campaign's real numbers and the 12 states Sage explored.

**Milestone post, 14 Aug** —
[Sage signing into ClawUp](https://x.com/shariq_ai/status/2088029838900904415) · 160 impressions.

Full content inventory with engagement: [`geo-contribution.md`](./geo-contribution.md).

---

## 5. One honest note on attribution

The campaign pointed testers at `https://clawup.org/` — the bare domain, not our referral link.
That was our oversight. Any backend attribution keyed on the referral link will therefore **not**
show these six signups, even though the signups are real, the agents were created, the channels were
connected, and the USDC was paid on-chain.

We are recording it here rather than leaving the discrepancy unexplained. The evidence stands on its
own: six wallets, eight written reports, four public proof pages, and one funded vault, all
independently checkable on GOAT Mainnet.

---

## Supporting materials

| Evidence | Where |
|---|---|
| Verbatim ClawUp mission reports | [`feedback-log.md`](./feedback-log.md) |
| On-chain payout ledger with proof links | [`payout-ledger.md`](./payout-ledger.md) |
| Seed user validation, both campaigns tracked separately | [`seed-user-validation.md`](./seed-user-validation.md) |
| MCP integration record and conformance output | [`../CLAWUP_INTEGRATION.md`](../CLAWUP_INTEGRATION.md) |
| Public campaign board | `https://sagepays.xyz/c/launch-clawup-org-tf62c8` |
| Campaign vault on GOAT | [`0xa3BFc35a…1537`](https://explorer.goat.network/address/0xa3BFc35a5eB2c1B52Ee9dcCb84d9a80380211537) |
