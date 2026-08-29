#!/usr/bin/env bash
# Declare and deploy SageClaims to Starknet.
#
# YOU run this, not the agent — it needs your keystore passphrase, and sncast
# prompts for it interactively. Never pass a passphrase as a CLI argument (it
# lands in shell history) and never put it in a file.
#
#   ./deploy.sh --keystore ~/.starkli-wallets/lumen/keystore.json \
#               --account  ~/.starkli-wallets/lumen/account.json
#
#   ./deploy.sh --account my-sncast-account-name      # sncast-native account
#
# Optional: --network sepolia (default mainnet), --url <rpc>
set -euo pipefail

KEYSTORE=""; ACCOUNT=""; NETWORK="mainnet"; URL="https://rpc.starknet.lava.build:443"
while [ $# -gt 0 ]; do
  case "$1" in
    --keystore) KEYSTORE="$2"; shift 2 ;;
    --account)  ACCOUNT="$2";  shift 2 ;;
    --network)  NETWORK="$2";  shift 2 ;;
    --url)      URL="$2";      shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ -n "$ACCOUNT" ] || { echo "usage: ./deploy.sh --account <name|path> [--keystore <path>]" >&2; exit 1; }

# The STRK20 privacy pool. Pinned into the contract at deployment: only this
# address may open the private door, and it can never be repointed afterwards.
POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"

cd "$(dirname "$0")"

# sncast reads a starkli keystore natively, but only when BOTH flags are given —
# with --keystore, --account is a PATH to the starkli account file, not a name.
AUTH=(--account "$ACCOUNT")
[ -n "$KEYSTORE" ] && AUTH=(--keystore "$KEYSTORE" --account "$ACCOUNT")

# Rebuild immediately before declaring. A stale artifact is one of the ways a
# deploy silently lands wrong, and it costs a full declare fee to discover.
echo "==> building"
scarb build

echo "==> running the full suite before spending anything"
snforge test

# A declare is charged by Sierra length, and one that runs out of funds still
# burns the fee. Price it before committing to it.
FELTS=$(node -e "console.log(require('./target/dev/sage_claims_SageClaims.contract_class.json').sierra_program.length)")
COST=$(node -e "console.log((${FELTS} * 0.0102).toFixed(2))")
echo
echo "==> SageClaims is ${FELTS} Sierra felts — declaring costs roughly ${COST} STRK"
echo "    plus ~0.25 STRK to deploy. Make sure the account holds more than that."
read -r -p "    Continue? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "stopped."; exit 0; }

echo
echo "==> declaring on ${NETWORK} (sncast will prompt for the passphrase)"
DECLARE_OUT=$(sncast "${AUTH[@]}" --url "$URL" declare --contract-name SageClaims 2>&1 || true)
echo "$DECLARE_OUT"

CLASS_HASH=$(echo "$DECLARE_OUT" | grep -oE '0x[0-9a-fA-F]{60,64}' | head -1)
if [ -z "$CLASS_HASH" ]; then
  echo
  echo "No class hash in that output. If it says the class is already declared,"
  echo "copy the hash and run the deploy step below by hand."
  exit 1
fi

echo
echo "==> deploying class ${CLASS_HASH} with the pool pinned"
DEPLOY_OUT=$(sncast "${AUTH[@]}" --url "$URL" deploy \
  --class-hash "$CLASS_HASH" --constructor-calldata "$POOL" 2>&1)
echo "$DEPLOY_OUT"

ADDRESS=$(echo "$DEPLOY_OUT" | grep -oE 'contract_address: *0x[0-9a-fA-F]+' | grep -oE '0x[0-9a-fA-F]+' | head -1)
[ -n "$ADDRESS" ] || { echo "Could not read the deployed address; check the output above."; exit 1; }

# Do not trust a successful transaction. Read a view function back and assert
# the value — a deploy can land with the wrong class at the address.
echo
echo "==> verifying: reading get_pool() back off the chain"
CALL_OUT=$(sncast --url "$URL" call --contract-address "$ADDRESS" --function get_pool 2>&1 || true)
echo "$CALL_OUT"
if echo "$CALL_OUT" | tr 'A-Z' 'a-z' | grep -q "$(echo "$POOL" | sed 's/^0x0*//' | tr 'A-Z' 'a-z')"; then
  echo "    OK — the pool pinned in the contract matches the one we deployed with."
else
  echo "    MISMATCH — get_pool() did not return the expected pool. Do not use this address."
  exit 1
fi

echo
echo "Deployed: $ADDRESS"
echo
echo "Next:"
echo "  1. Put it in .env:  STARKNET_CLAIMS_ADDRESS=$ADDRESS"
echo "     alongside STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY."
echo "     Sage treats a partially-set group as ABSENT, so set all four or none."
echo "  2. Add the address to strk20.json under \"contracts\"."
echo "  3. npm run starknet:payout -- --amounts 1.40,0.65,1.15"
