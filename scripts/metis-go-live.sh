#!/usr/bin/env bash
# METIS GO-LIVE, step by step, from this Mac. Each step says what it will do; every step that sends a
# transaction or changes the server asks first, and nothing secret is ever printed.
#
#   scripts/metis-go-live.sh                status: balances, what is deployed, what the server has set (read-only)
#   scripts/metis-go-live.sh factory        deploy the job factory with the operator key (contracts/.env), set it on the server
#   scripts/metis-go-live.sh identity       register Sage's ERC-8004 identity on Metis, set it on the server
#   scripts/metis-go-live.sh x402-key       on the server: create the x402 facilitator's own key (once), print its address
#   scripts/metis-go-live.sh x402           on the server: deploy the Permit2 proxy with that key, switch the facilitator on
#   scripts/metis-go-live.sh billing 0x…    set the address plan payments and Metis x402 sales are paid to
#
# Order: fund the operator → factory → identity → (fund the facilitator) → x402 → billing. Any order works
# after the factory; each step is safe to run twice (it sees what is already done).
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=~/Documents/ssh-key3.key; VM=ubuntu@80.225.209.190; R=/home/ubuntu/sage
RPC='https://andromeda.metis.io/?owner=1088'
EXPLORER='https://andromeda-explorer.metis.io'
OPERATOR=0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6
PROXY=0xC5Df359394de02F8E04bfb650E250b20a33BEe6a
S() { ssh -n -o StrictHostKeyChecking=no -i "$KEY" "$VM" "$@"; }
say() { printf '%s\n' "$*"; }
ask() { read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || [ "$a" = "Y" ] || { say "Stopped. Nothing more was done."; exit 0; }; }
metis() { cast balance "$1" --rpc-url "$RPC" --ether 2>/dev/null || echo "?"; }
vm_has() { S "grep -q '^$1=' $R/.env" && echo yes || echo no; }

# Replace or append one line of the server's .env, after a timestamped backup. Values here are addresses
# and switches, never keys (the facilitator key is made on the server and never crosses the wire).
vm_set() {
  case "$2" in *[!A-Za-z0-9_.:/?=x-]*) say "REFUSED: unexpected characters in the value for $1"; exit 1;; esac
  S "cd $R && cp .env .env.bak-\$(date -u +%Y%m%dT%H%M%SZ) && if grep -q '^$1=' .env; then sed -i 's#^$1=.*#$1=$2#' .env; else printf '\n$1=$2\n' >> .env; fi && chmod 600 .env"
  say "  server .env: $1 set"
}

# A restart picks the new settings up. It waits for any payout in flight, exactly as a deploy does.
restart() {
  cat > /tmp/golive-guard.cjs <<'JS'
const db = require("/home/ubuntu/sage/node_modules/better-sqlite3")("/home/ubuntu/sage/var/sage.db", { readonly: true });
const rows = db.prepare(`select s.status, count(*) as n from submissions s left join decisions d on d.submission_id = s.id
  where s.status = 'settling' or (s.status = 'pending' and d.id is null) group by s.status`).all();
console.log(JSON.stringify(rows)); process.exit(rows.length ? 1 : 0);
JS
  ssh -o StrictHostKeyChecking=no -i "$KEY" "$VM" "cat > /home/ubuntu/golive-guard.cjs" < /tmp/golive-guard.cjs
  S "node /home/ubuntu/golive-guard.cjs" >/dev/null || { say "A payout is in flight; run this step again in a minute. The setting is saved; it applies on the next restart."; exit 3; }
  S "cd $R && pm2 restart sage --update-env >/dev/null && sleep 7 && pm2 status sage | grep -E 'sage ' | awk -F'│' '{print \"  pm2:\", \$3, \$10}'"
}

facilitator_address() { S "cd $R && node scripts/vm/facilitator-key.mjs address"; }

status() {
  say "== Metis go-live status (read-only)"
  say "operator   $OPERATOR   $(metis $OPERATOR) METIS   (needs >= 0.05 to deploy the factory; ~0.5 to run)"
  say "factory    set on server: $(vm_has METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS)"
  say "identity   set on server: $(vm_has ERC8004_METIS_AGENT_ID)"
  local fa; fa="$(facilitator_address || true)"
  if [ -n "$fa" ]; then say "x402 key   $fa   $(metis "$fa") METIS   (needs >= 0.03 to deploy the proxy; ~0.25 to run)"; else say "x402 key   not created yet (scripts/metis-go-live.sh x402-key)"; fi
  local code; code="$(cast code $PROXY --rpc-url "$RPC" 2>/dev/null || echo 0x)"
  say "x402 proxy $PROXY   $([ "${#code}" -gt 10 ] && echo deployed || echo 'not deployed')"
  say "x402 on    $(vm_has X402_METIS_ENABLED)   /api/x402/metis/supported → $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://sagepays.xyz/api/x402/metis/supported)"
  say "billing    set on server: $(vm_has SAGE_BILLING_ADDRESS)"
  if curl -s --max-time 30 https://sagepays.xyz/ | grep -q 'opening on Metis'; then say "site       Metis still shows as opening"; else say "site       Metis is open for new jobs"; fi
}

case "${1:-status}" in
  status) status ;;

  factory)
    if [ "$(vm_has METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS)" = yes ]; then say "The server already has a Metis factory set. Nothing to do."; exit 0; fi
    say "Operator $OPERATOR holds $(metis $OPERATOR) METIS. The deploy costs about 0.03 METIS."
    ask "Deploy the CampaignVaultFactory on Metis now (a real transaction from the operator)?"
    OUT="$(bash contracts/script/deploy-campaign-factory-metis.sh 2>&1 | tee /dev/stderr)"
    ADDR="$(printf '%s\n' "$OUT" | grep -oE 'METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS=0x[0-9a-fA-F]{40}' | head -1 | cut -d= -f2)"
    [ -n "$ADDR" ] || { say "No factory address in the output above; the server was not changed."; exit 1; }
    vm_set METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS "$ADDR"
    vm_set METIS_MAINNET_OPERATOR_ADDRESS "$OPERATOR"
    restart
    status
    say "Next: scripts/metis-go-live.sh identity"
    ;;

  identity)
    if [ "$(vm_has ERC8004_METIS_AGENT_ID)" = yes ]; then say "The server already has Sage's Metis identity. Nothing to do."; exit 0; fi
    ask "Register Sage's ERC-8004 identity on Metis now (one transaction from the operator, ~0.005 METIS)?"
    node scripts/register-erc8004.mjs --chain metis Sage
    for name in ERC8004_METIS_AGENT_ID ERC8004_METIS_AGENT_ADDRESS ERC8004_METIS_AGENT_NAME; do
      v="$(grep -E "^$name=" .env | tail -1 | cut -d= -f2- | tr -d '"' || true)"
      [ -n "$v" ] && vm_set "$name" "$v"
    done
    restart
    ;;

  x402-key)
    fa="$(facilitator_address || true)"
    if [ -z "$fa" ]; then
      ask "Create the x402 facilitator's own key on the server (it never leaves the server)?"
      fa="$(S "cd $R && node scripts/vm/facilitator-key.mjs create")"
    fi
    say "x402 facilitator address: $fa   ($(metis "$fa") METIS)"
    say "Send it about 0.25 METIS on the Metis network (0.03 at least: the proxy deploy, then ~0.002 per settlement)."
    say "Then: scripts/metis-go-live.sh x402"
    ;;

  x402)
    fa="$(facilitator_address || true)"
    [ -n "$fa" ] || { say "Create the facilitator key first: scripts/metis-go-live.sh x402-key"; exit 1; }
    say "Facilitator $fa holds $(metis "$fa") METIS."
    S "cd $R && node contracts/script/deploy-x402-permit2-proxy-metis.mjs"
    code="$(cast code $PROXY --rpc-url "$RPC" 2>/dev/null || echo 0x)"
    if [ "${#code}" -le 10 ]; then
      ask "Deploy the Permit2 proxy now (a real transaction from the facilitator, ~0.011 METIS)?"
      S "cd $R && node contracts/script/deploy-x402-permit2-proxy-metis.mjs --send"
    fi
    vm_set X402_METIS_PERMIT2_PROXY_ADDRESS "$PROXY"
    vm_set X402_METIS_ENABLED 1
    restart
    say "  /api/x402/metis/supported → $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://sagepays.xyz/api/x402/metis/supported)"
    say "  Sage's own tools on Metis: https://sagepays.xyz/mcp/metis/sage_first_look (402 until paid; paid to the billing address)"
    say "  First real payment: PAYER_KEY=0x… node scripts/x402-metis-pay.mjs sage_first_look '{\"url\":\"https://sagepays.xyz\"}' --approve"
    ;;

  billing)
    addr="${2:-}"
    [[ "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || { say "usage: scripts/metis-go-live.sh billing 0x<your wallet address>"; exit 1; }
    ask "Send plan payments and Metis x402 sales to $addr?"
    vm_set SAGE_BILLING_ADDRESS "$addr"
    restart
    ;;

  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
