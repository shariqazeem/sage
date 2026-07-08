#!/usr/bin/env bash
# Deploy the Deputy PolicyVault stack to Metis Sepolia and wire the app.
#
#   1. script/Deploy.s.sol       → MockUSDC + PolicyVaultFactory
#   2. script/CreateVault.s.sol  → the "Launch Growth" vault (500 USDC, active)
#
# Captures the deployed addresses into contracts/.env and the app's root .env
# (NEXT_PUBLIC_VAULT_ADDRESS / NEXT_PUBLIC_USDC_ADDRESS), then prints verifiable
# block-explorer links. Idempotent re-runs deploy a fresh stack.
#
# Prereq: contracts/.env has a FUNDED PRIVATE_KEY (testnet METIS for gas).
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"
CDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$CDIR/.." && pwd)"
cd "$CDIR"

# shellcheck disable=SC1091
set -a; source "$CDIR/.env"; set +a

RPC="${METIS_SEPOLIA_RPC:-https://sepolia.metisdevops.link}"
EXPLORER="https://sepolia-explorer.metisdevops.link"
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"

echo "▸ Deployer:  $DEPLOYER"
BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
echo "▸ Balance:   $BAL wei"
if [ "$BAL" = "0" ]; then
  echo "✗ Deployer has 0 balance. Fund $DEPLOYER with Metis Sepolia gas, then re-run." >&2
  exit 1
fi

set_env() { # file key value  → upsert KEY=VALUE
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f"; then
    sed -i '' "s|^$k=.*|$k=$v|" "$f"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}

# --legacy: Metis settles with a fixed gas price (no EIP-1559 priority fees).
echo "▸ [1/2] Deploying MockUSDC + PolicyVaultFactory…"
D_OUT="$(forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --legacy 2>&1)"
echo "$D_OUT" | grep -E "deployed" || true
USDC="$(echo "$D_OUT"    | grep -i "MockUSDC deployed at"        | grep -oE '0x[a-fA-F0-9]{40}' | head -1)"
FACTORY="$(echo "$D_OUT" | grep -i "PolicyVaultFactory deployed" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)"
[ -n "$USDC" ] && [ -n "$FACTORY" ] || { echo "✗ Failed to parse Deploy addresses." >&2; echo "$D_OUT" >&2; exit 1; }
set_env "$CDIR/.env" USDC_ADDRESS "$USDC"
set_env "$CDIR/.env" FACTORY_ADDRESS "$FACTORY"
export USDC_ADDRESS="$USDC" FACTORY_ADDRESS="$FACTORY"
echo "  MockUSDC:  $USDC"
echo "  Factory:   $FACTORY"

echo "▸ [2/2] Creating + funding + activating the Launch Growth vault…"
C_OUT="$(forge script script/CreateVault.s.sol --rpc-url "$RPC" --broadcast --legacy 2>&1)"
echo "$C_OUT" | grep -E "Vault|Owner|Operator" || true
VAULT="$(echo "$C_OUT" | grep -i "Vault created" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)"
[ -n "$VAULT" ] || { echo "✗ Failed to parse vault address." >&2; echo "$C_OUT" >&2; exit 1; }

# Wire the app: write the public addresses into the root .env.
set_env "$ROOT/.env" NEXT_PUBLIC_VAULT_ADDRESS "$VAULT"
set_env "$ROOT/.env" NEXT_PUBLIC_USDC_ADDRESS "$USDC"

echo ""
echo "✓ Deployed to Metis Sepolia (chainId 59902)."
echo "  Vault:    $VAULT"
echo "  Verify →  $EXPLORER/address/$VAULT"
echo "  USDC →    $EXPLORER/address/$USDC"
echo "  Factory → $EXPLORER/address/$FACTORY"
echo ""
echo "Wrote NEXT_PUBLIC_VAULT_ADDRESS to $ROOT/.env — restart \`npm run dev\` to pick it up."
