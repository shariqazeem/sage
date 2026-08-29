#!/usr/bin/env bash
# Declare and deploy SageClaims to Starknet.
#
# Run this yourself — it signs with your key, which nothing else in this repo
# ever sees or needs.
#
#   ./deploy.sh <sncast-account-name> [network]
#
# `network` defaults to mainnet; pass `sepolia` to rehearse first, which is
# worth doing once because a declare is charged by Sierra length and a mistake
# is paid for twice.
set -euo pipefail

ACCOUNT="${1:?usage: ./deploy.sh <sncast-account-name> [mainnet|sepolia]}"
NETWORK="${2:-mainnet}"

# The STRK20 privacy pool. Pinned into the contract at deployment: only this
# address may open the private door, and it can never be repointed afterwards.
POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"

cd "$(dirname "$0")"

echo "==> building"
scarb build

echo "==> running the full suite before spending anything"
snforge test

echo
echo "==> declaring SageClaims on ${NETWORK} as '${ACCOUNT}'"
echo "    (if the class is already declared this reports it and continues)"
DECLARE_OUT=$(sncast --account "$ACCOUNT" declare \
  --contract-name SageClaims --network "$NETWORK" 2>&1 || true)
echo "$DECLARE_OUT"

CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oE '0x[0-9a-fA-F]{60,64}' | head -1)
if [ -z "$CLASS_HASH" ]; then
  echo
  echo "Could not read a class hash from the declare output."
  echo "If it says the class is already declared, copy that hash and run:"
  echo "  sncast --account $ACCOUNT deploy --class-hash <hash> \\"
  echo "    --constructor-calldata $POOL --network $NETWORK"
  exit 1
fi

echo
echo "==> deploying class ${CLASS_HASH} with pool ${POOL}"
sncast --account "$ACCOUNT" deploy \
  --class-hash "$CLASS_HASH" \
  --constructor-calldata "$POOL" \
  --network "$NETWORK"

echo
echo "Done. Put the deployed address in .env as STARKNET_CLAIMS_ADDRESS,"
echo "alongside STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY."
echo "Sage treats a partially-set group as ABSENT, so set all four or none."
