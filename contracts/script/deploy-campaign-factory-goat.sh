#!/usr/bin/env bash
# Deploy the V2 CampaignVaultFactory on GOAT mainnet (chainId 2345).
# The wizard's founders call factory.createCampaignVault() from their own wallet;
# this script only deploys the factory. Signs with GOAT_AGENT_PRIVATE_KEY from
# contracts/.env. Prints GOAT_CAMPAIGN_FACTORY_ADDRESS to paste back.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # contracts/
cd "$HERE"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${GOAT_AGENT_PRIVATE_KEY:?Set GOAT_AGENT_PRIVATE_KEY in contracts/.env}"
RPC="${GOAT_RPC_URL:-https://rpc.goat.network}"

echo "▸ Deploying CampaignVaultFactory (V2) on GOAT mainnet — $RPC"
run() {
  forge create src/CampaignVaultFactory.sol:CampaignVaultFactory \
    --rpc-url "$RPC" --private-key "$GOAT_AGENT_PRIVATE_KEY" --broadcast "$@"
}
# EIP-1559 first; GOAT sometimes needs legacy gas → fall back to --legacy.
OUT="$(run 2>&1)" || OUT="$(run --legacy 2>&1)"
echo "$OUT"

ADDR="$(printf '%s\n' "$OUT" | grep -iE 'Deployed to:' | grep -oiE '0x[0-9a-fA-F]{40}' | head -1)"
if [ -z "$ADDR" ]; then
  echo "✗ Could not parse the deployed address — check the forge output above."
  exit 1
fi
echo
echo "✓ GOAT CampaignVaultFactory (V2): $ADDR"
echo "  → paste this address back; it becomes GOAT_CAMPAIGN_FACTORY_ADDRESS on the VM"
