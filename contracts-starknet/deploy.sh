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
#
# The default RPC is Cartridge, which serves spec 0.10.2. sncast 0.56 expects
# 0.10.0 and rejects older nodes — rpc.starknet.lava.build is still on 0.8.1,
# so it warns and cannot be relied on for a declare.
set -euo pipefail

KEYSTORE=""; ACCOUNT=""; NETWORK="mainnet"; URL="https://api.cartridge.gg/x/starknet/mainnet"
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
# In 0.56 --keystore/--account are GLOBAL flags while --url belongs to the
# subcommand; putting --url first fails with "unexpected argument".
AUTH=(--account "$ACCOUNT")
[ -n "$KEYSTORE" ] && AUTH=(--keystore "$KEYSTORE" --account "$ACCOUNT")

# The node has to speak a spec sncast understands. Checked BEFORE the build so a
# wrong endpoint costs a second rather than a failed declare's fee.
echo "==> checking the RPC"
SPEC=$(curl -s --max-time 10 -X POST "$URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_specVersion","params":[]}' \
  | node -pe "try{JSON.parse(require('fs').readFileSync(0,'utf8')).result||''}catch(e){''}")
case "$SPEC" in
  0.10.*) echo "    $URL — spec $SPEC, OK" ;;
  "")     echo "    could not read a spec version from $URL"; exit 1 ;;
  *)      echo "    $URL speaks spec $SPEC; sncast 0.56 needs 0.10.x."
          echo "    Try --url https://api.cartridge.gg/x/starknet/mainnet"
          exit 1 ;;
esac

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
DECLARE_OUT=$(sncast "${AUTH[@]}" declare --contract-name SageClaims --url "$URL" 2>&1 || true)
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
DEPLOY_OUT=$(sncast "${AUTH[@]}" deploy \
  --class-hash "$CLASS_HASH" --constructor-calldata "$POOL" --url "$URL" 2>&1)
echo "$DEPLOY_OUT"

ADDRESS=$(echo "$DEPLOY_OUT" | grep -oE 'contract_address: *0x[0-9a-fA-F]+' | grep -oE '0x[0-9a-fA-F]+' | head -1)
[ -n "$ADDRESS" ] || { echo "Could not read the deployed address; check the output above."; exit 1; }

# Do not trust a successful transaction. Read a view function back and assert
# the value — a deploy can land with the wrong class at the address.
echo
echo "==> verifying: reading get_pool() back off the chain"
CALL_OUT=$(sncast call --contract-address "$ADDRESS" --function get_pool --url "$URL" 2>&1 || true)
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
