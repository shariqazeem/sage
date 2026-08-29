#!/usr/bin/env bash
# Declare and deploy SageClaims to Starknet, using starkli.
#
# YOU run this. starkli prompts for the keystore passphrase and reads it from
# the terminal — never pass it as an argument (it lands in shell history), never
# put it in a file, and do not set STARKNET_KEYSTORE_PASSWORD.
#
#   ./deploy.sh --keystore ~/.starkli-wallets/lumen/keystore.json \
#               --account  ~/.starkli-wallets/lumen/account.json
#
# Optional: --rpc <url>
#
# The default is lava.build. starkli 0.4.2 speaks an older JSON-RPC spec than
# Cartridge's 0.10.2 serves and dies with "Invalid block id" — the block tags
# were renamed. A NEWER node is not a better node here; it has to match the
# tool. starknet.js works with either, so the app can share this endpoint.
#
# WHY starkli AND NOT sncast: sncast 0.56 documents `--keystore` as taking a
# starkli account file, but it does not honour it — pointing --keystore at a
# path that does not exist produces the SAME error as pointing it at the real
# one, because it silently falls through to ~/.starknet_accounts and fails
# looking up a network there. starkli owns this key format; it is the right
# tool, not a workaround.
set -euo pipefail

KEYSTORE=""; ACCOUNT=""; RPC="https://rpc.starknet.lava.build:443"
while [ $# -gt 0 ]; do
  case "$1" in
    --keystore) KEYSTORE="$2"; shift 2 ;;
    --account)  ACCOUNT="$2";  shift 2 ;;
    --rpc)      RPC="$2";      shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ -n "$KEYSTORE" ] && [ -n "$ACCOUNT" ] || {
  echo "usage: ./deploy.sh --keystore <path> --account <path> [--rpc <url>]" >&2; exit 1; }
[ -f "$KEYSTORE" ] || { echo "no keystore at $KEYSTORE" >&2; exit 1; }
[ -f "$ACCOUNT" ]  || { echo "no account file at $ACCOUNT" >&2; exit 1; }

# The STRK20 privacy pool. Pinned into the contract at deployment: only this
# address may open the private door, and it can never be repointed afterwards.
POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
SIERRA="target/dev/sage_claims_SageClaims.contract_class.json"

cd "$(dirname "$0")"
AUTH=(--rpc "$RPC" --account "$ACCOUNT" --keystore "$KEYSTORE")

echo "==> checking that starkli can actually talk to this node"
# NOT a spec-version check. starkli read `block-number` fine from a node it then
# failed every call against, so the version number was a useless predictor. This
# performs the same KIND of request the declare will, against a known contract,
# and believes only the result.
POOL_PROBE=$(starkli call "$POOL" get_fee_amount --rpc "$RPC" 2>&1 | head -2 | tr -d '\n') || true
case "$POOL_PROBE" in
  *0x*) echo "    $RPC — starkli can read the pool, OK" ;;
  *)    echo "    starkli cannot call contracts on $RPC:"
        echo "      $POOL_PROBE"
        echo "    Try --rpc https://rpc.starknet.lava.build:443"
        exit 1 ;;
esac

# Rebuild immediately before declaring. A stale artifact is one of the ways a
# deploy silently lands wrong, and it costs a full declare fee to find out.
echo "==> building"
scarb build

echo "==> running the full suite before spending anything"
snforge test

# NOTE: `*_unittest_SageClaims.test.contract_class.json` also exists in target/dev.
# That is the test harness build, not the contract. Declaring it would deploy the
# wrong thing, so the path is explicit rather than globbed.
[ -f "$SIERRA" ] || { echo "missing $SIERRA — did scarb build succeed?" >&2; exit 1; }

# A declare is charged by Sierra length, and one that runs out of funds still
# burns the fee. Price it before committing to it.
FELTS=$(node -pe "require('./${SIERRA}').sierra_program.length")
COST=$(node -pe "(${FELTS} * 0.0102).toFixed(2)")
echo
echo "==> SageClaims is ${FELTS} Sierra felts — declaring costs roughly ${COST} STRK,"
echo "    plus ~0.25 STRK to deploy."
read -r -p "    Continue? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "stopped."; exit 0; }

echo
echo "==> declaring (starkli will prompt for the passphrase)"
LOG=$(mktemp -t sage-deploy)
starkli declare "$SIERRA" "${AUTH[@]}" 2>&1 | tee "$LOG" || true
CLASS_HASH=$(grep -oE '0x[0-9a-fA-F]{60,64}' "$LOG" | tail -1)
[ -n "$CLASS_HASH" ] || { echo "No class hash in that output — stopping."; exit 1; }

echo
echo "==> deploying class ${CLASS_HASH} with the pool pinned"
starkli deploy "$CLASS_HASH" "$POOL" "${AUTH[@]}" 2>&1 | tee "$LOG" || true
ADDRESS=$(grep -oE '0x[0-9a-fA-F]{60,64}' "$LOG" | tail -1)
# The class hash appears in the deploy output too; make sure we did not take it
# for the address.
[ "$ADDRESS" = "$CLASS_HASH" ] && ADDRESS=""
[ -n "$ADDRESS" ] || { echo "Could not read the deployed address — stopping."; exit 1; }

# Do not trust a successful transaction. Read a view function back and assert
# the value: a deploy can land with the wrong class at the address, and a
# succeeded tx does not prove otherwise.
echo
echo "==> verifying: reading get_pool() back off the chain"
GOT=$(starkli call "$ADDRESS" get_pool --rpc "$RPC" 2>&1 | grep -oE '0x[0-9a-fA-F]+' | head -1)
NORM_GOT=$(echo "$GOT"  | sed 's/^0x0*//' | tr 'A-Z' 'a-z')
NORM_EXP=$(echo "$POOL" | sed 's/^0x0*//' | tr 'A-Z' 'a-z')
if [ "$NORM_GOT" = "$NORM_EXP" ]; then
  echo "    OK — get_pool() returns the pool we deployed with."
else
  echo "    MISMATCH — got '$GOT', expected '$POOL'. Do not use this address."
  exit 1
fi

echo
echo "Deployed: $ADDRESS"
echo
echo "Next:"
echo "  1. .env:  STARKNET_CLAIMS_ADDRESS=$ADDRESS"
echo "     with STARKNET_RPC_URL=$RPC, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY."
echo "     Sage treats a partially-set group as ABSENT, so set all four or none."
echo "  2. Add $ADDRESS to strk20.json under \"contracts\"."
echo "  3. npm run starknet:payout -- --amounts 1.40,0.65,1.15"
