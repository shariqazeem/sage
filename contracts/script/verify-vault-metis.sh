#!/usr/bin/env bash
# VERIFY A JOB VAULT ON THE METIS EXPLORER (12 Nov 2026).
#
# Every job on Metis gets its own CampaignVault, created by the factory 0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9
# (verified on andromeda-explorer.metis.io, exact match, 12 Nov 2026). A vault's source is the factory's own
# (src/CampaignVault.sol, the same compiler settings), but each vault is its own address with its own constructor
# arguments, so each one is verified once, after it is created:
#
#   contracts/script/verify-vault-metis.sh 0x<vault>          checks, then submits
#   contracts/script/verify-vault-metis.sh 0x<vault> --dry    checks only, submits nothing
#
# The arguments come from the vault's own creation code on the explorer: the bytes after the CampaignVault creation
# code this repo builds. If the explorer's code does not start with this build, the vault is not one of ours (or the
# build has drifted) and nothing is submitted. EXPLORER can point at another Blockscout (e.g. GOAT's) for a dry run.
set -euo pipefail
VAULT="${1:-}"
DRY="${2:-}"
[[ "$VAULT" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "usage: $0 0x<vault address> [--dry]"; exit 1; }
EXPLORER="${EXPLORER:-https://andromeda-explorer.metis.io}"
CHAIN_ID="${CHAIN_ID:-1088}"
HERE="$(cd "$(dirname "$0")/.." && pwd)" # contracts/
cd "$HERE"

info() { curl -s -m 30 "$EXPLORER/api/v2/smart-contracts/$VAULT"; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];console.log(v==null?"":String(v))}catch{console.log("")}})' "$1"; }

if [ "$(info | field is_verified)" = "true" ]; then
  echo "✓ $VAULT is already verified: $EXPLORER/address/$VAULT?tab=contract"
  exit 0
fi

forge build --skip test --skip script >/tmp/verify-vault-build.log 2>&1 || { tail -20 /tmp/verify-vault-build.log; echo "✗ the contracts did not build"; exit 1; }
LOCAL="$(node -e 'console.log(require("./out/CampaignVault.sol/CampaignVault.json").bytecode.object.toLowerCase())')"
CREATION="$(info | field creation_bytecode | tr 'A-F' 'a-f')"
[ -n "$CREATION" ] || { echo "✗ the explorer has no creation code for $VAULT yet (is it a contract, and indexed?)"; exit 1; }
case "$CREATION" in
  "$LOCAL"*) ;;
  *) echo "✗ $VAULT was not built from this repo's CampaignVault (its creation code differs). Nothing submitted."; exit 1 ;;
esac
ARGS="0x${CREATION:${#LOCAL}}"
echo "▸ $VAULT is this repo's CampaignVault; constructor arguments: $(( (${#ARGS} - 2) / 2 )) bytes"

if [ "$DRY" = "--dry" ]; then
  echo "  dry run: nothing submitted"
  exit 0
fi

forge verify-contract "$VAULT" src/CampaignVault.sol:CampaignVault --chain-id "$CHAIN_ID" \
  --verifier blockscout --verifier-url "$EXPLORER/api/" --compiler-version 0.8.24 --constructor-args "$ARGS" >/dev/null
# the explorer finishes in the background; its own record is the answer
for _ in $(seq 1 12); do
  if [ "$(info | field is_verified)" = "true" ]; then
    echo "✓ verified: $EXPLORER/address/$VAULT?tab=contract"
    exit 0
  fi
  sleep 5
done
echo "✗ submitted, but the explorer has not marked $VAULT verified after a minute: check $EXPLORER/address/$VAULT?tab=contract"
exit 1
