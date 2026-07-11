# Metis Sepolia safety exercise — v1

> Controlled **Metis Sepolia testnet (chain 59902)** verification of the upgraded,
> replay-protected payout foundation. Public addresses + transaction hashes only —
> **no keys or secrets**. All USDC below is valueless MockUSDC test token; native
> gas is testnet tMETIS. No mainnet chain (2345 / 1088) was involved at any point.

Explorer: `https://sepolia-explorer.metisdevops.link`

## Roles (owner ≠ operator ≠ recipient — proven)

| Role | Address |
|---|---|
| Owner / deployer | `0xb77e6f5466cf52524e8465859277f192Be0bCfe4` |
| Operator (fresh **disposable** testnet key) | `0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35` |
| Recipient (receive-only) | `0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3` |

The operator key is disposable Metis Sepolia infrastructure — never reused for
GOAT / mainnet / production / ERC-8004 / x402. It was proven to be leashed: its
`queueAddVendor` reverts (owner-only), so it cannot execute governance.

## Deployed contracts (fresh, upgraded)

| Contract | Address |
|---|---|
| PolicyVaultFactory (upgraded, check 7) | `0x43C4823873DE9979f4B12bAedE201AFBc832b0B8` |
| PolicyVault (tiny policy) | `0xa37DE5781c297CbB0F5e10AD89C638517506416d` |
| MockUSDC (existing, reused) | `0xF176f521290A937d81cc5878dfc19908f4D681A1` |

**Policy:** budget 2 · per-tx cap 0.5 · 24h velocity 1 · duration 7 days · vendor
timelock 0 (all tUSDC).

## Transactions (ordered)

| # | Action | Tx hash | Result |
|---|---|---|---|
| 1 | Fund operator (0.02 tMETIS) | `0x9fc9858b7f6363b1dbace093163c0d70d6e48488b32d245530348d23d590fd0d` | ok |
| 2 | Deploy PolicyVaultFactory | `0x3e05930a0c75182cae3821e3701102b2f8466a215e20d99119ccd5a8a417fffd` | ok |
| 3 | createVault | `0x310813e8188aeecac9020df6fa8930ca85b9d34cd2304772768f50c855738dbf` | ok |
| 4 | mint 2 tUSDC → owner | `0xcb86b8000cc4dcbec01d789879ecc4cf75866ee8d88542981800001a7a6afdfc` | ok |
| 5 | approve vault | `0xfa1bc4c66f3e1272f50e564a55f7666b90a98592783efa9406f1f074a52b3176` | ok |
| 6 | fund(2) | `0x2d79f2c831785580303395f2185b9d7109e676d85d772b1317121a9f039b3b51` | ok |
| 7 | activate() | `0xb5155990c7b97f931b8878b7aeb226cf71ac0c8f4b495f15862abb82a38e5dff` | ok |
| 8 | owner queueAddVendor(recipient) | `0x574625b740bf0aef06138009a73fccbf6241a3f373734dd536d00b86d23b64a2` | ok |
| 9 | owner executeAddVendor(recipient) | `0x444a947a4380eef203a187d470f8aae6fcccaa092603862f740afe4998f8df49` | ok |
| 10 | **SETTLE (app pipeline)** — 0.5 tUSDC | `0x239364b7c3f5222f07a998f447efed48e15f927acfba7dfeb5218cf5b531d186` | **SpendSettled** |
| 11 | direct replay (consumed intent) | `0x18790db4eec45464959102ef8b42542ec58f396e96ae0299fe6d637762a0938c` | **SpendRejected #7**, 0 moved |
| 12 | overspend 0.6 > 0.5 cap | `0x1b3145da3ee4a09079716fa51f4e57e7f8d4a807bb58573d4e47c664c14adb94` | **SpendRejected #4**, 0 moved |

## The decision-committed settlement (#10)

| Field | Value |
|---|---|
| Campaign / submission / decision | `-Hw15ZY5BY` / `hVXRKbJaICVl` / `zvxv2nYrooSb` |
| Engine / model / provider | llm / `google/gemini-3.1-flash-lite-preview` / `api.commonstack.ai` |
| Recommendation / confidence / reason | pay / 1.0 / `all_criteria_met` |
| Evidence SHA-256 | `ff67a9d764d6a2367a187734e697f6a53217db9a21c101d410a113ca871a299d` |
| decisionDigest | `0xa774105c15f6445374fa1357a5947333a445f106679919d5e0ef457408700a23` |
| payoutIntentHash (stored) | `0x9d03692c5f14c982069717b8fce24b90aa18b9cdab54340f64d3b176aed7cd40` |
| On-chain event intentHash | `0x9d03692c5f14c982069717b8fce24b90aa18b9cdab54340f64d3b176aed7cd40` (**matches**) |
| Recipient balance | 0 → 500000 (exactly +0.5 tUSDC) |
| Vault totalSpent | 0 → 500000 (once) |
| `isIntentUsed(payoutIntentHash)` | **true** (consumed) |
| Proof state | `committed_settlement`, verified, not legacy, commitmentMatches ✓ |

## Replay safety (both distinct paths)

- **Application-level** (durable resume): re-invoking `settleWithRecovery` +
  re-running the pipeline reused settle tx #10, `skipped`, and moved **zero**
  additional funds (recipient / totalSpent / payout count all unchanged).
- **Contract-level** (#11): a direct operator `requestSpend` with the consumed
  intent emitted `SpendRejected(failedCheckIndex = 7)` and moved zero tokens; the
  intent remained consumed.

## Policy rejection (#12)

A direct overspend of 0.6 tUSDC (> 0.5 cap) emitted
`SpendRejected(failedCheckIndex = 4)`, moved zero tokens, and left its fresh
intent **unconsumed** (retryable) — the composer classifies it as a rejection,
never a settlement.
