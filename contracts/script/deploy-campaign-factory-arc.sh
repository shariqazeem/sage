#!/usr/bin/env bash
# Deploy the V2 CampaignVaultFactory on Arc mainnet (chainId 5042).
# Same contract as GOAT and Arc testnet; no constructor arguments. Signs with GOAT_AGENT_PRIVATE_KEY
# from contracts/.env — the operator, 0x0deF…44D6, which pays the gas in USDC (Arc's native token).
# Prints the address to set as ARC_MAINNET_CAMPAIGN_FACTORY_ADDRESS on the VM.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # contracts/
cd "$HERE"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${GOAT_AGENT_PRIVATE_KEY:?Set GOAT_AGENT_PRIVATE_KEY in contracts/.env}"
RPC="${ARC_MAINNET_RPC_URL:-https://rpc.mainnet.arc.io}"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN_ID" = "5042" ] || { echo "✗ $RPC is chain $CHAIN_ID, not Arc mainnet (5042)"; exit 1; }

echo "▸ Deploying CampaignVaultFactory (V2) on Arc mainnet — $RPC"
OUT="$(forge create src/CampaignVaultFactory.sol:CampaignVaultFactory --rpc-url "$RPC" --private-key "$GOAT_AGENT_PRIVATE_KEY" --broadcast 2>&1)"
echo "$OUT" | grep -vi "private"
ADDR="$(printf '%s\n' "$OUT" | grep -iE 'Deployed to:' | grep -oiE '0x[0-9a-fA-F]{40}' | head -1)"
[ -n "$ADDR" ] || { echo "✗ Could not parse the deployed address — check the forge output above."; exit 1; }
CODE="$(cast code "$ADDR" --rpc-url "$RPC")"
[ "${#CODE}" -gt 10 ] || { echo "✗ No code at $ADDR"; exit 1; }
echo
echo "✓ Arc mainnet CampaignVaultFactory (V2): $ADDR  (code ${#CODE} chars)"
echo "  → ARC_MAINNET_CAMPAIGN_FACTORY_ADDRESS=$ADDR on the VM"
