#!/usr/bin/env bash
# Deploy a DISPOSABLE "kill-demo" vault on Metis Sepolia for the kill-switch
# demo. revoke() is terminal, so this stands in for the primary vault — the
# primary is never revoked. Reuses the existing factory + MockUSDC (no .sol
# changes); larger 5000 USDC budget so it's never strained. Writes the address
# to the app env as NEXT_PUBLIC_KILL_VAULT_ADDRESS.
#
# Prereq: contracts/.env with a FUNDED PRIVATE_KEY + FACTORY_ADDRESS, USDC_ADDRESS,
# OPERATOR_ADDRESS (all set by deploy-sepolia.sh).
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

BUDGET=5000000000 # 5000 USDC (6 decimals) — large headroom for the demo
PERTX=25000000    # 25 USDC
VELOCITY=100000000 # 100 USDC / day
DURATION=1209600  # 14 days
TIMELOCK=0

# Approved vendors — same keccak-of-name derivation as CreateVault.s.sol. They
# matter because a post-revoke requestSpend to an APPROVED vendor must still fail
# at the STATE check (index 1), proving the revoke (not a vendor rejection).
vendor() { local h; h="$(cast keccak "$1")"; h="${h#0x}"; echo "0x${h:24}"; }
V=("$(vendor Clearbit)" "$(vendor Hunter)" "$(vendor Apollo)" "$(vendor Perplexity)" "$(vendor Exa)")
VENDORS="[$(IFS=,; echo "${V[*]}")]"

echo "▸ Deployer:  $DEPLOYER"
echo "▸ Creating kill-demo vault (5000 USDC) via existing factory $FACTORY_ADDRESS…"
cast send "$FACTORY_ADDRESS" \
  "createVault(address,address,address,uint256,uint256,uint256,uint256,address[],uint256)" \
  "$OPERATOR_ADDRESS" "0x0000000000000000000000000000000000000000" "$USDC_ADDRESS" \
  "$BUDGET" "$PERTX" "$VELOCITY" "$DURATION" "$VENDORS" "$TIMELOCK" \
  --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --legacy >/dev/null

# Newest vault for this owner = last entry.
VAULTS="$(cast call "$FACTORY_ADDRESS" "getVaultsByOwner(address)(address[])" "$DEPLOYER" --rpc-url "$RPC")"
KILL="$(echo "$VAULTS" | tr -d '[] ' | tr ',' '\n' | tail -1)"
echo "  Kill vault: $KILL"

# SAFETY: must never be the primary vault.
KILL_LC="$(echo "$KILL" | tr 'A-Z' 'a-z')"
PRIMARY_LC="$(echo "${NEXT_PUBLIC_VAULT_ADDRESS:-}" | tr 'A-Z' 'a-z')"
if [ -n "$PRIMARY_LC" ] && [ "$KILL_LC" = "$PRIMARY_LC" ]; then
  echo "✗ kill vault equals the primary vault — aborting." >&2
  exit 1
fi

echo "▸ Fund + activate (mint 5000 mUSDC → approve → fund → activate)…"
cast send "$USDC_ADDRESS" "mint(address,uint256)" "$DEPLOYER" "$BUDGET" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --legacy >/dev/null
cast send "$USDC_ADDRESS" "approve(address,uint256)" "$KILL" "$BUDGET" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --legacy >/dev/null
cast send "$KILL" "fund(uint256)" "$BUDGET" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --legacy >/dev/null
cast send "$KILL" "activate()" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --legacy >/dev/null

STATE="$(cast call "$KILL" "getState()(uint8)" --rpc-url "$RPC")"
echo "  Kill vault state: $STATE (expect 2 = Active)"

set_env() {
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f"; then sed -i '' "s|^$k=.*|$k=$v|" "$f"; else printf '%s=%s\n' "$k" "$v" >> "$f"; fi
}
set_env "$ROOT/.env" NEXT_PUBLIC_KILL_VAULT_ADDRESS "$KILL"
set_env "$CDIR/.env" KILL_VAULT_ADDRESS "$KILL"

echo ""
echo "✓ Kill-demo vault ready (disposable; the primary is untouched)."
echo "  Verify → $EXPLORER/address/$KILL"
echo "  Wrote NEXT_PUBLIC_KILL_VAULT_ADDRESS to $ROOT/.env — restart dev to pick it up."
