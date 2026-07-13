# Installing the Sage skill into the ClawUp agent

> This skill is **built and packaged**; it is **not yet installed** into the live ClawUp
> runtime. Installation is a **gated step** — do not claim it works until you have run the
> manual checklist below inside the actual running ClawUp agent.

## 1. Configure the server (Sage side)

Set one secret in Sage's protected environment (the same `~/sage/.env` the app sources).
Generate a strong random token and share it with the ClawUp agent runtime only.

```
# on the Sage server, in ~/sage/.env (never commit; chmod 600):
SAGE_AGENT_API_KEY=<a long random token>
```

Until this is set, every `/api/agent/*` route returns **404 (not configured)** — the surface
fails closed. Restart Sage after setting it. The boot line will show the agent API as
configured.

## 2. Install the skill into ClawUp

In the ClawUp dashboard for the Sage agent:

1. Add a custom skill and paste the contents of `SKILL.md` (or point the agent at this file's
   published URL).
2. In the agent's runtime config (dashboard env, or `openclaw.json` if the dashboard can't hold
   custom vars), set `SAGE_AGENT_API_KEY` to the **same** token as the server. The agent presents
   it as `Authorization: Bearer $SAGE_AGENT_API_KEY` on every call.
3. Keep the agent's identity/wallet as the existing GOAT & Metis identity (ERC-8004 #79 wallet
   `0x0deF…44D6`). Do **not** mint a second Sage identity.

## 3. Manual verification checklist (run against the live agent)

Do **not** report the integration as working until all of these pass in the running ClawUp agent:

- [ ] Server: `SAGE_AGENT_API_KEY` set; `curl -s -o /dev/null -w '%{http_code}' https://sagepays.xyz/api/agent/campaigns/founding-testers` **without** a key returns **404**.
- [ ] With the key, `GET /api/agent/campaigns/founding-testers` returns `ok:true` and a testnet
      `token: "mUSDC"` / `isTestnet: true` (never `$`).
- [ ] In Telegram, ask the agent to inspect a real product with a budget → it calls
      `start_product_inspection`, polls status, and returns a mission-plan summary + an
      `approvalUrl` of the form `https://sagepays.xyz/launch/<id>`.
- [ ] Opening that `approvalUrl` in a browser shows the plan; the agent did **not** approve or fund.
- [ ] After the founder funds the campaign, "what has Sage done?" returns real activity with a
      `proofUrl` for any paid submission — and the amount reads "test mUSDC", not "$".
- [ ] The agent refuses / cannot produce any signing, funding, or payout action.

## What this seam can and cannot do

**Can:** start real inspections, poll durable jobs, return approval links, read campaign /
submission status, return verified proofs, report activity.

**Cannot (by construction — verified in tests):** accept a private key, sign anything, call
`requestPayout`, settle, repair a hash, or claim founder ownership. Every wallet approval stays in
the Sage web app; the existing pipeline remains the one and only payout initiator.
