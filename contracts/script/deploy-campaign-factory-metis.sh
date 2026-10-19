#!/usr/bin/env bash
# Deploy the V2 CampaignVaultFactory on Metis mainnet (Andromeda, chainId 1088).
# Same contract as GOAT and Arc; no constructor arguments. Signs with GOAT_AGENT_PRIVATE_KEY from
# contracts/.env, the shared operator 0x0deF…44D6, which pays the gas in METIS. Andromeda prices gas
# legacy-style (no base fee), hence --legacy. The deploy costs ~2.2M gas (forge gas report), about
# 0.03 METIS at ~13 gwei. Fund the operator with ~1 METIS first: that covers this deploy, the launch
# stipends and ~100 payouts of reserve.
# Prints the settings to put on the VM.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # contracts/
cd "$HERE"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${GOAT_AGENT_PRIVATE_KEY:?Set GOAT_AGENT_PRIVATE_KEY in contracts/.env}"
RPC="${METIS_MAINNET_RPC_URL:-https://andromeda.metis.io/?owner=1088}"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN_ID" = "1088" ] || { echo "✗ $RPC is chain $CHAIN_ID, not Metis mainnet (1088)"; exit 1; }
OPERATOR="$(cast wallet address --private-key "$GOAT_AGENT_PRIVATE_KEY")"
BAL="$(cast balance "$OPERATOR" --rpc-url "$RPC" --ether)"
echo "▸ operator $OPERATOR holds $BAL METIS on Metis mainnet"
awk -v b="$BAL" 'BEGIN { exit !(b+0 >= 0.05) }' || { echo "✗ fund the operator with ~1 METIS first (it has $BAL)"; exit 1; }

echo "▸ Deploying CampaignVaultFactory (V2) on Metis mainnet — $RPC"
OUT="$(forge create src/CampaignVaultFactory.sol:CampaignVaultFactory --rpc-url "$RPC" --private-key "$GOAT_AGENT_PRIVATE_KEY" --legacy --broadcast 2>&1)"
echo "$OUT" | grep -vi "private"
ADDR="$(printf '%s\n' "$OUT" | grep -iE 'Deployed to:' | grep -oiE '0x[0-9a-fA-F]{40}' | head -1)"
[ -n "$ADDR" ] || { echo "✗ Could not parse the deployed address — check the forge output above."; exit 1; }
CODE="$(cast code "$ADDR" --rpc-url "$RPC")"
[ "${#CODE}" -gt 10 ] || { echo "✗ No code at $ADDR"; exit 1; }
echo
echo "✓ Metis mainnet CampaignVaultFactory (V2): $ADDR  (code ${#CODE} chars)"
echo "  On the VM (.env), then restart:"
echo "    METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS=$ADDR"
echo "    METIS_MAINNET_OPERATOR_ADDRESS=$OPERATOR"
echo "    METIS_MAINNET_RPC_URL=$RPC"
