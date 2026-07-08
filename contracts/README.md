# Deputy — Policy Vault Contracts

On-chain enforcement for Deputy's autonomous AI workers. **The AI proposes; the
chain enforces.** A `PolicyVault` holds a user's funds and guarantees that an AI
operator can never exceed its budget, pay an unapproved vendor, bypass spending
limits, or keep running after revocation — even if the operator key or backend is
fully compromised.

Built with [Foundry](https://book.getfoundry.sh/). Solidity `0.8.24`,
`evm_version = paris` for portability across Metis Andromeda and any EVM chain.

---

## Contracts

| Contract | Role |
|----------|------|
| `src/PolicyVault.sol` | One per operator. Custodies funds, enforces the mandate, emits events. |
| `src/PolicyVaultFactory.sol` | Deploys vaults via CREATE2 (deterministic), indexes them by owner. |
| `src/interfaces/IPolicyVault.sol` | Integration surface: enum, `Policy` struct, events, errors, `requestSpend` + views. |
| `test/mocks/MockUSDC.sol` | 6-decimal ERC-20 with open mint, for tests/testnet. |

### Roles

| Role | Authority |
|------|-----------|
| **Owner** | Fund, activate, pause/unpause, lower caps, manage vendors, set guardian, revoke, withdraw. |
| **Guardian** | `revoke()` only (emergency kill). Cannot withdraw or change policy. |
| **Operator** (AI key) | `requestSpend()` only. Cannot withdraw, fund, or change anything. |

### State machine

```
Created → Funded → Active ⇄ Paused
                     │         │
                     └────┬────┘
                          ▼
                       Revoked   (terminal; or auto-expired by time)
```

### The spend flow (`requestSpend`)

The operator proposes a payment. Checks run in order; on failure the call
**soft-rejects** (returns `false`, emits `SpendRejected`, moves no funds) so the
caller learns which check failed — it does **not** revert. `failedCheckIndex`
maps directly to the frontend's Gate replay:

| Index | Check | Guarantee |
|------:|-------|-----------|
| 1 | State (Active & not expired) | G3/G4 |
| 2 | Caller is the operator | — |
| 3 | Vendor is approved | **G2** |
| 4 | Amount > 0 and ≤ per-tx cap | G3 |
| 5 | `totalSpent + amount` ≤ budget ceiling | **G1** |
| 6 | Within rolling 24h velocity cap | G3 |

On success: funds transfer to the vendor, accounting updates, `SpendSettled` is
emitted. Both events carry the `intentHash` (a hash of the AI's reasoning) for
later attestation linkage.

---

## Setup

Requires Foundry (`forge`). Install: `curl -L https://foundry.paradigm.xyz | bash && foundryup`.

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0   # already vendored in lib/
forge build
```

## Test

```bash
forge test            # 35 tests
forge test -vvv       # verbose traces
forge test --gas-report
```

## Deploy

**One command** (Metis Sepolia). Needs a **funded** `PRIVATE_KEY` in `.env`
(testnet gas — get tMETIS from [faucet.metis.io](https://faucet.metis.io)):

```bash
cp .env.example .env          # set PRIVATE_KEY (funded) and OPERATOR_ADDRESS
script/deploy-sepolia.sh      # deploys, funds + activates, writes addresses into
                              # contracts/.env and the app's root .env
```

The script runs the two Foundry scripts below, parses the deployed addresses,
wires `NEXT_PUBLIC_VAULT_ADDRESS` / `NEXT_PUBLIC_USDC_ADDRESS` into the app, and
prints verifiable explorer links. Gas is trivial — a full deploy is ≈ `0.00001
tMETIS` (gas price ~0.001 gwei). To run the steps by hand instead:

```bash
# 1) MockUSDC (testnet) + the factory
forge script script/Deploy.s.sol --rpc-url $METIS_SEPOLIA_RPC --broadcast --legacy
#    → copy the logged addresses into .env (FACTORY_ADDRESS, USDC_ADDRESS), set OPERATOR_ADDRESS

# 2) Create + fund + activate the "Launch Growth" vault (500 USDC, 25/tx, 100/day, 14d)
forge script script/CreateVault.s.sol --rpc-url $METIS_SEPOLIA_RPC --broadcast --legacy
```

`--legacy` is used because Metis settles with a fixed gas price (no EIP-1559
priority fees).

### Live deployment (Metis Sepolia, chainId 59902)

| Contract | Address |
|----------|---------|
| PolicyVault (`launch-growth`) | [`0x52A7Ae4e7812472C2F6D4A7eAf76EDD4475E6279`](https://sepolia-explorer.metisdevops.link/address/0x52A7Ae4e7812472C2F6D4A7eAf76EDD4475E6279) |
| PolicyVaultFactory | [`0x9b885D79c03A43D638195b72818CbCC2d496D9A2`](https://sepolia-explorer.metisdevops.link/address/0x9b885D79c03A43D638195b72818CbCC2d496D9A2) |
| MockUSDC | [`0xF176f521290A937d81cc5878dfc19908f4D681A1`](https://sepolia-explorer.metisdevops.link/address/0xF176f521290A937d81cc5878dfc19908f4D681A1) |

---

## Critical invariants (enforced by construction)

1. `totalSpent ≤ budgetCeiling` — always (budget check before effects).
2. `token.balanceOf(vault) ≥ budgetCeiling − totalSpent` — `activate()` requires
   the vault to fully back its ceiling; spend decrements balance and `totalSpent`
   in lockstep. No fractional reserve.
3. `Revoked` is terminal — no function transitions out of it.
4. Only owner/guardian can `revoke()`; only operator can `requestSpend()`.
5. `budgetCeiling`, `duration`, `paymentToken` are `immutable` — cannot change.
6. `perTransactionCap` / `dailyVelocityCap` can only decrease (`CannotRaiseCap`).
7. Vendor additions are timelocked; removals are instant.
8. After expiry, all spends reject at the state check.
9. `withdrawRemaining` only when Revoked or expired, owner only.

---

## Design decisions / deviations from the prompt

- **Soft-reject, never revert, on policy failure.** `requestSpend` returns
  `false` + emits `SpendRejected(failedCheckIndex)` for checks 1–6 (including a
  non-operator caller, index 2), exactly as specified, so the backend/frontend
  can reconstruct the Gate. Funds never move on a rejection.
- **Zero-amount spend** is folded into the amount check (index 4) and
  soft-rejected (not reverted), matching the "reject with a specific check"
  guidance.
- **Funding fully backs the ceiling.** `activate()` requires
  `balance ≥ budgetCeiling`, which makes invariant #2 hold by construction and
  guarantees a settling transfer can never fail for insufficient balance.
- **`Exceeds*` revert errors are unused by design.** The protocol spec lists
  `ExceedsBudgetCeiling` etc. as reverts, but `requestSpend` soft-rejects, so
  those conditions surface as `SpendRejected` events instead. We did not define
  unused errors (keeps `forge build` clean).
- **State left unpacked for auditability.** `requestSpend` median ≈ 46k gas, avg
  ≈ 86k — both under 100k. The first spend on a fresh vault is a one-time ~160k
  due to zero→nonzero initialization of four storage slots plus the token's cold
  recipient slot; every subsequent spend is the warm ~32–46k path. Per the spec's
  "don't over-optimize at the cost of readability," we kept the trackers as
  separate `uint256`s rather than bit-packing them under 100k.
- **`evm_version = paris`** for L2 portability (avoids PUSH0/Shanghai opcodes).
- **Extra getters** (`getOwner`, `getGuardian`, `getPendingVendorReadyAt`,
  `getVendorAddTimelock`) and a `setGuardian` owner function were added for
  frontend wiring and the roles table's "owner can set guardian."

Not included (later prompts): ERC-8004, LazAI, x402, upgradeable proxies,
governance, native-asset support.
