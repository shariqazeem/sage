# Sage — Agentic Workflow

The Payout Deputy: how a real payment flows from work submitted to USDC settled,
with the Policy Vault as the sole on-chain authority. Covers inputs, agent
orchestration, human-in-the-loop steps, data sources & APIs, key decision points,
and outputs.

```mermaid
flowchart TD
  %% ---------------- INPUTS ----------------
  POSTER["Poster / Organization<br/>funds a vault - sets budget, rule, caps"] --> CV["Campaign + funded<br/>Policy Vault (on-chain)"]
  WORKER["Participant / Worker<br/>submits work + evidence URL"] --> INTAKE

  %% ---------------- AGENT ORCHESTRATION ----------------
  subgraph AGENT["Payout Deputy - autonomous agent orchestration"]
    INTAKE["Intake<br/>SIWE-auth submitter - dedupe (wallet + evidence)"]
    MATCH{"Decision: is the condition<br/>genuinely met?<br/>match criteria - anti-spam"}
    COMPUTE["Compute exact payout<br/>+ deterministic intent hash"]
    PROPOSE["Propose spend<br/>requestSpend(recipient, amount, intentHash)"]
  end

  CV --> INTAKE
  INTAKE --> MATCH
  INTAKE -.->|persist| DB[("Sage DB<br/>campaigns - submissions - journal")]
  MATCH -.->|pay per-call| X402[("x402 gated verification<br/>and data APIs - min 0.1 USDC")]
  X402 -.->|result| MATCH
  MATCH -->|no| REJECT["Reject / hold"]
  MATCH -->|yes| COMPUTE
  COMPUTE --> PROPOSE

  %% ---------------- HUMAN IN THE LOOP ----------------
  OWNER["Owner (human) - wallet-signed<br/>approve - allowlist recipient (timelocked)<br/>lower cap - revoke (tighten-only)"]
  OWNER -.->|approve / allowlist| PROPOSE
  OWNER -.->|govern| VAULT

  %% ---------------- ENFORCEMENT (decision) ----------------
  PROPOSE --> VAULT
  CHAIN[("On-chain state<br/>vault - events - balances")] -.->|read| VAULT
  VAULT{"Policy Vault - sole on-chain authority<br/>6 checks: state - caller - recipient<br/>per-tx cap - budget - velocity"}
  VAULT -->|all pass| SETTLE["USDC settles to a real person"]
  VAULT -->|any fail| BLOCK["Blocked on-chain - no funds move"]

  %% ---------------- OUTPUTS ----------------
  SETTLE --> PROOF["Public proof page<br/>verifiable receipt"]
  SETTLE --> FEE["Operator fee via x402<br/>(monetization)"]
  SETTLE --> REP["ERC-8004 identity<br/>reputation = real payout history"]
  SETTLE --> JOURNAL["Trustless work journal<br/>chain-derived - never client-authored"]
  BLOCK --> JOURNAL

  classDef dec fill:#eef1fd,stroke:#4f46e5,stroke-width:2px,color:#1a1d21;
  classDef settle fill:#eef6f0,stroke:#15803d,color:#14532d;
  classDef block fill:#fdeeee,stroke:#dc2626,color:#7f1d1d;
  classDef vault fill:#1a1d21,stroke:#1a1d21,color:#fbfbf9,stroke-width:2px;
  classDef data fill:#fafaf8,stroke:#b45309,color:#7a5307;
  classDef human fill:#fdf6ec,stroke:#b45309,color:#7a5307;
  class MATCH dec;
  class VAULT vault;
  class SETTLE,PROOF,FEE,REP settle;
  class BLOCK,REJECT block;
  class X402,CHAIN,DB data;
  class OWNER human;
```

## Legend (the six required elements)

- **Inputs** — the Poster funds a vault and sets the rule; the Participant submits work + evidence.
- **Agent orchestration** — the Payout Deputy: intake + dedupe → condition match → compute payout → propose spend.
- **Data sources & APIs** — x402 gated verification/data endpoints (paid per call), on-chain state reads, the Sage DB.
- **Human-in-the-loop** — the owner only, wallet-signed: approve/allowlist a recipient, lower a cap, revoke. Tighten-only, never loosen.
- **Key decision points** — (1) is the condition genuinely met? (2) the Policy Vault's six on-chain checks.
- **Outputs** — USDC settles (or is blocked on-chain), a public proof receipt, the operator fee via x402, ERC-8004 reputation, and a trustless chain-derived work journal.
