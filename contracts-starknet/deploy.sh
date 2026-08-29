#!/usr/bin/env bash
# Build, test, price, then declare and deploy SageClaims.
#
# YOU run this. The passphrase is typed at a prompt with echo off, used only to
# decrypt the keystore in memory, and never written to a file, an argument, an
# environment variable or shell history.
#
#   ./deploy.sh --keystore ~/.starkli-wallets/lumen/keystore.json \
#               --account  ~/.starkli-wallets/lumen/account.json
#
# Optional: --rpc <url>
#
# SIGNING IS DONE BY starknet.js (scripts/starknet-deploy.mjs), not by starkli
# or sncast. Both were tried on mainnet and neither works here:
#
#   starkli 0.4.2 — the latest release, from July 2025 — computes the
#   compiled-class hash with a superseded algorithm (reading OUR CASM file it
#   still reported 0x03acfcf3…, where the correct hash is 0x59cebdb3…) and asks
#   for the retired `pending` block tag.
#
#   sncast 0.56 documents --keystore as taking a starkli account file and does
#   not honour it: a nonexistent keystore path gives the identical error as the
#   real one, because it falls through to ~/.starknet_accounts.
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

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SIERRA="$HERE/target/dev/sage_claims_SageClaims.contract_class.json"
CASM="$HERE/target/dev/sage_claims_SageClaims.compiled_contract_class.json"

# Rebuild immediately before declaring: a stale artifact is one of the ways a
# deploy silently lands wrong, and it costs a full declare fee to find out.
echo "==> building"
(cd "$HERE" && scarb build)

echo "==> running the full suite before spending anything"
(cd "$HERE" && snforge test)

# NOTE: target/dev also holds *_unittest_SageClaims.test.contract_class.json —
# the test harness build. Declaring that would deploy the wrong contract, so
# both paths are explicit rather than globbed.
[ -f "$SIERRA" ] || { echo "missing $SIERRA — did scarb build succeed?" >&2; exit 1; }
[ -f "$CASM" ]   || { echo "missing $CASM — is casm = true in Scarb.toml?" >&2; exit 1; }

# A declare is charged by Sierra length, and one that runs out of funds still
# burns the fee. Price it before committing to it.
FELTS=$(node -pe "require('$SIERRA').sierra_program.length")
COST=$(node -pe "($FELTS * 0.0102).toFixed(2)")
echo
echo "==> SageClaims is ${FELTS} Sierra felts — declaring costs roughly ${COST} STRK,"
echo "    plus ~0.25 STRK to deploy."
read -r -p "    Continue? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "stopped."; exit 0; }
echo

cd "$ROOT"
exec node scripts/starknet-deploy.mjs \
  --keystore "$KEYSTORE" --account "$ACCOUNT" --rpc "$RPC"
