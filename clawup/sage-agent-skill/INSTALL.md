# Installing Sage into the ClawUp agent

> The Sage MCP server is **built and tested**; it is **not yet bound** into the live ClawUp
> agent. Binding is a **gated step** — don't claim it works until the checklist below passes
> against the actual running ClawUp agent.

Sage plugs into ClawUp as a **custom MCP tool** (ClawUp's native tool mechanism) plus a
**persona**. Two artifacts:

- **The MCP server** — `https://sagepays.xyz/mcp` — exposes Sage's five tools
  (`sage_start_inspection`, `sage_get_inspection`, `sage_get_campaign`, `sage_get_submission`,
  `sage_get_proof`). It runs the SAME verified operations as the REST agent API, and is
  provably read + inspection-start only (`agent-api.test.ts`).
- **The persona** — `SKILL.md` — the agent's instructions: what Sage is, the one-time approval
  boundary, truthful money language, and how to chain the tools.

## 1. Server side (already live on the VM)

`SAGE_AGENT_API_KEY` is set in `~/sage/.env` (mode 600). Until it's set, `/mcp` and
`/api/agent/*` fail closed (404). The MCP endpoint is live at `https://sagepays.xyz/mcp`.

## 2. Submit Sage as a private MCP tool

ClawUp → **Tool Marketplace → Submit MCP**:

| Field        | Value                          |
| ------------ | ------------------------------ |
| Endpoint URL | `https://sagepays.xyz/mcp`     |
| Transport    | `http` (HTTP-streaming)        |
| Auth scheme  | `api_key`                      |
| Name         | `sage`                         |

Submit. It's a **private** tool (`owned_by_viewer`) → you can bind it to your own agent
**immediately**, without waiting for public review.

## 3. Bind it to Sage Concierge + set the key

Open the **Sage Concierge** agent → **Tools** → find `sage` → **Install / Bind**. When prompted
for the api_key, paste `SAGE_AGENT_API_KEY`. Reveal the value locally (never in chat):

```
grep '^SAGE_AGENT_API_KEY=' /Users/macbookair/projects/SAGE/.env.staging.metissafety | cut -d= -f2-
```

ClawUp stores it encrypted and injects it on every call.

## 4. Set the persona

Set the agent's persona / custom instructions to the contents of `SKILL.md`. That gives it the
identity, the "founder approves + funds once, the agent never signs" boundary, the
testnet-mUSDC vs mainnet-USDC money truth, and how to chain the tools.

## 5. Verification checklist (run against the live agent)

- [ ] `curl -s -X POST https://sagepays.xyz/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` lists the five `sage_*` tools.
- [ ] In ClawUp / Telegram, ask the agent to inspect a real product with a budget → it calls
      `sage_start_inspection`, polls `sage_get_inspection`, and returns a mission-plan summary +
      an `approvalUrl` of the form `https://sagepays.xyz/launch/<id>`.
- [ ] Opening that `approvalUrl` shows the plan; the agent did **not** approve or fund.
- [ ] "What has Sage done?" → `sage_get_campaign` returns real activity + a `proofUrl` for any
      paid submission, with the amount read as testnet **mUSDC**, never "$".
- [ ] The agent cannot produce any signing, funding, or payout action.

## What this can and cannot do

**Can:** start real inspections, poll durable jobs, return approval links, read campaign /
submission status, return verified proofs.

**Cannot (by construction — verified in `agent-api.test.ts`):** accept a private key, sign, call
`requestPayout`, settle, or claim founder ownership. Every wallet approval stays in the Sage web
app; the existing pipeline remains the one and only payout initiator.
