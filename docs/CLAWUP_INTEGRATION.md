# Sage ↔ ClawUp integration — status & evidence

> Honest record of the ClawUp integration as of 2026-07-13. Truthful by rule: we state exactly
> what is operational, what is blocked, and by whom.

## One-line truth

**Sage's MCP server is operational and standards-tested (official SDK, conformance 7/7).
ClawUp's Marketplace tool-binding is currently blocked by a platform-wide HTTP 500 — reproduced
on Sage *and on unrelated public tools* — and has been reported to the ClawUp team.**

We do **not** claim "Sage works inside ClawUp" — the in-ClawUp bind has not succeeded (blocked by
their platform). We do **not** claim the public MCP submission is approved — it remains pending.

## What is operational (ours)

- **Sage MCP server** at `https://sagepays.xyz/mcp`, rebuilt on the official
  `@modelcontextprotocol/sdk` stateless Streamable-HTTP transport.
- Exposes 5 read/inspection-start tools: `sage_start_inspection`, `sage_get_inspection`,
  `sage_get_campaign`, `sage_get_submission`, `sage_get_proof`. Provably **cannot** sign, settle,
  or move funds (`agent-api.test.ts` structural gate).
- **Conformance: 7/7** via the official SDK client (`scripts/mcp-conformance.mjs`), run from
  outside the app process against the live endpoint:
  ```
  PASS  no-auth handshake is refused
  PASS  initialize succeeds, serverInfo.name == 'sage'
  PASS  tools/list returns exactly 5 tools
  PASS  the five tools are the sage_* set
  PASS  no tool exposes signing/settlement
  PASS  tools/call runs; bogus id → isError (not a crash)
  PASS  unknown tool is rejected with a protocol error
  ```
- The full Sage Agent API + inspection loop (inspect → ProductMap → mission plan →
  `/launch/<id>`) is live and was demonstrated end-to-end.

## What is blocked (ClawUp platform)

- **`POST https://clawup.org/api/v1/agents/{agentId}/tools/{name}` returns HTTP 500** during
  "Validate & Install", for Sage **and unrelated public Marketplace tools**.
- Our server logs prove our side is healthy: ClawUp's `clawup-validator/1.0.0` connects,
  authenticates (`auth=ok`), sends `initialize` (protocol `2025-03-26`), receives a valid
  response, then errors **inside ClawUp** before ever calling `tools/list`. ClawUp exposes no
  error detail (generic `HTTP_500`).
- Ruled out on our side across many iterations: auth, JSON vs SSE framing, capabilities shape,
  session id — all correct; the official SDK client handshakes cleanly.
- **Reported to the ClawUp team.** The public MCP submission is **pending**, not rejected.

## Native-skill bypass — investigated, not viable

ClawUp's OpenClaw runtime offers **no user-accessible path to install a native skill / packaged
command outside the Marketplace MCP bind**. The Files API exposes only persona/memory
(`SOUL.md`/`IDENTITY.md`/memory), not executable external-API skills; there is no user env-var
config for a secret (key would have to be hardcoded — refused on security grounds). Conclusion:
the in-ClawUp path depends on ClawUp fixing the platform bind bug. No agent config was changed.

## Re-test criteria

Re-attempt the Marketplace bind **only after ClawUp announces a fix**. Our MCP server is ready and
binds the instant their `/tools/{name}` endpoint stops 500-ing — no further server changes needed.
