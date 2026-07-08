#!/usr/bin/env bash
# Deploy the Deputy PolicyVault stack to GOAT MAINNET (chain 2345) with REAL USDC.
#
#   1. script/DeployGoat.s.sol      → PolicyVaultFactory
#   2. script/CreateVaultGoat.s.sol → create + fund + activate the dogfood vault
#
# Signs with the ERC-8004 agent key (GOAT_AGENT_PRIVATE_KEY). Tries EIP-1559
# first and falls back to --legacy if the GOAT RPC rejects a 1559 tx — logging
# which path went through. Writes GOAT_FACTORY_ADDRESS + GOAT_VAULT_ADDRESS to
# the app's root .env. One factory, one vault — never re-run blindly (it deploys
# a fresh stack each time and spends real gas + real USDC).
#
# Amounts are env-driven (USDC 6dp base units; duration seconds), e.g.:
#   GOAT_BUDGET=4000000 GOAT_PER_TX=500000 GOAT_VELOCITY=2000000 \
#   GOAT_DURATION=5184000 bash script/deploy-goat.sh
#   (GOAT_FUND defaults to GOAT_BUDGET — the vault must fully back its ceiling.)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
CDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$CDIR/.." && pwd)"
cd "$CDIR"

# Load the agent key (contracts/.env) + any amount overrides (root .env).
set -a
[ -f "$CDIR/.env" ] && source "$CDIR/.env"
[ -f "$ROOT/.env" ] && source "$ROOT/.env"
set +a

RPC="${GOAT_RPC_URL:-https://rpc.goat.network}"
EXPLORER="https://explorer.goat.network"
export GOAT_USDC_ADDRESS="${GOAT_USDC_ADDRESS:-0x3022b87ac063DE95b1570F46f5e470F8B53112D8}"

# Amounts (6dp base units). Defaults are conservative; override via env.
export GOAT_BUDGET="${GOAT_BUDGET:-4000000}"       # 4 USDC budget ceiling
export GOAT_FUND="${GOAT_FUND:-$GOAT_BUDGET}"      # fund == budget (needed to activate)
export GOAT_PER_TX="${GOAT_PER_TX:-500000}"        # 0.5 USDC per payout
export GOAT_VELOCITY="${GOAT_VELOCITY:-2000000}"   # 2 USDC / rolling day
export GOAT_DURATION="${GOAT_DURATION:-5184000}"   # 60 days

[ -n "${GOAT_AGENT_PRIVATE_KEY:-}" ] || { echo "✗ GOAT_AGENT_PRIVATE_KEY not set (contracts/.env)." >&2; exit 1; }
AGENT="$(cast wallet address --private-key "$GOAT_AGENT_PRIVATE_KEY")"
BAL_BTC="$(cast balance "$AGENT" --rpc-url "$RPC")"
echo "▸ Agent (deployer=owner=operator): $AGENT"
echo "▸ Gas balance:  $BAL_BTC wei BTC"
echo "▸ Budget/Fund:  $GOAT_BUDGET / $GOAT_FUND base · per-tx $GOAT_PER_TX · velocity $GOAT_VELOCITY · duration ${GOAT_DURATION}s"
if [ "$BAL_BTC" = "0" ]; then echo "✗ Agent has 0 BTC gas on GOAT. Bridge some, then re-run." >&2; exit 1; fi

GAS_PATH=""
run_forge() { # $1 = script path → echoes forge output, sets GAS_PATH
  local script="$1" out
  if out="$(forge script "$script" --rpc-url "$RPC" --broadcast 2>&1)"; then
    GAS_PATH="eip1559"; echo "$out"; return 0
  fi
  echo "  ! EIP-1559 rejected; retrying --legacy…" >&2
  if out="$(forge script "$script" --rpc-url "$RPC" --broadcast --legacy 2>&1)"; then
    GAS_PATH="legacy"; echo "$out"; return 0
  fi
  echo "$out" >&2; return 1
}

set_env() { # file key value → upsert KEY=VALUE (BSD/macOS sed)
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f" 2>/dev/null; then sed -i '' "s|^$k=.*|$k=$v|" "$f"; else printf '%s=%s\n' "$k" "$v" >> "$f"; fi
}

echo "▸ [1/2] Deploy PolicyVaultFactory…"
D_OUT="$(run_forge script/DeployGoat.s.sol)"
FACTORY="$(echo "$D_OUT" | grep -i "PolicyVaultFactory deployed" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)"
[ -n "$FACTORY" ] || { echo "✗ couldn't parse factory address." >&2; echo "$D_OUT" >&2; exit 1; }
export GOAT_FACTORY_ADDRESS="$FACTORY"
set_env "$ROOT/.env" GOAT_FACTORY_ADDRESS "$FACTORY"
echo "  Factory: $FACTORY   (gas path: $GAS_PATH)"

echo "▸ [2/2] Create + fund + activate the dogfood vault (REAL USDC)…"
C_OUT="$(run_forge script/CreateVaultGoat.s.sol)"
VAULT="$(echo "$C_OUT" | grep -i "Vault created" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)"
[ -n "$VAULT" ] || { echo "✗ couldn't parse vault address." >&2; echo "$C_OUT" >&2; exit 1; }
set_env "$ROOT/.env" GOAT_VAULT_ADDRESS "$VAULT"
echo "  Vault:   $VAULT   (gas path: $GAS_PATH)"

echo ""
echo "✓ Deployed to GOAT mainnet (chainId 2345)."
echo "  Factory → $EXPLORER/address/$FACTORY"
echo "  Vault   → $EXPLORER/address/$VAULT"
echo "  Wrote GOAT_FACTORY_ADDRESS + GOAT_VAULT_ADDRESS to $ROOT/.env."
echo "  Restart the app: ensureDemoCampaign() now points the dogfood at GOAT mainnet."
