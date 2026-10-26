#!/usr/bin/env bash
# METIS GO-LIVE, step by step, from this Mac. Each step says what it will do; every step that sends a
# transaction or changes the server asks first, and nothing secret is ever printed.
#
#   scripts/metis-go-live.sh                status: balances, what is deployed, what the server has set (read-only)
#   scripts/metis-go-live.sh factory        deploy the job factory with the operator key (contracts/.env), set it on the server
#   scripts/metis-go-live.sh identity       register Sage's ERC-8004 identity on Metis, set it on the server
#   scripts/metis-go-live.sh billing 0x…    set the address plan payments and Metis x402 sales are paid to (your wallet)
#   scripts/metis-go-live.sh x402-key       on the server: create the x402 facilitator's own key (once), print its address
#   scripts/metis-go-live.sh x402           on the server: deploy the Permit2 proxy with that key, switch the facilitator on
#
# Order: fund the operator → factory → identity → billing → (fund the facilitator) → x402. Each step is
# safe to run twice: it sees what is already done, on the server, on chain, or in var/metis-go-live.env
# (the addresses this Mac deployed; public, gitignored), and never deploys or registers twice.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=~/Documents/ssh-key3.key; VM=ubuntu@80.225.209.190; R=/home/ubuntu/sage
RPC='https://andromeda.metis.io/?owner=1088'
OPERATOR=0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6
PROXY=0xC5Df359394de02F8E04bfb650E250b20a33BEe6a
REC=var/metis-go-live.env
S() { ssh -n -o StrictHostKeyChecking=no -i "$KEY" "$VM" "$@"; }
say() { printf '%s\n' "$*"; }
ask() { read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || [ "$a" = "Y" ] || { say "Stopped. Nothing more was done."; exit 0; }; }
metis() { cast balance "$1" --rpc-url "$RPC" --ether 2>/dev/null || echo "?"; }
has_code() { local c; c="$(cast code "$1" --rpc-url "$RPC" 2>/dev/null || echo 0x)"; [ "${#c}" -gt 10 ]; }
vm_has() { S "grep -q '^$1=' $R/.env" && echo yes || echo no; }
# Reads one non-secret setting (an address, a chain id, a switch); refuses anything that names a key.
vm_get() { case "$1" in *KEY*|*SECRET*|*TOKEN*) say "REFUSED: vm_get never reads $1"; exit 1;; esac; S "grep '^$1=' $R/.env | tail -1 | cut -d= -f2-" || true; }
rec_get() { { grep -E "^$1=" "$REC" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
rec_set() { mkdir -p var; touch "$REC"; { grep -vE "^$1=" "$REC" || true; } > "$REC.tmp"; printf '%s=%s\n' "$1" "$2" >> "$REC.tmp"; mv "$REC.tmp" "$REC"; }

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
  local f; f="$(rec_get METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS)"
  say "factory    set on server: $(vm_has METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS)${f:+   (deployed from this Mac: $f)}"
  say "identity   set on server: $(vm_has ERC8004_METIS_AGENT_ID)"
  local b; b="$(vm_get SAGE_BILLING_ADDRESS)"
  say "billing    ${b:-not set (scripts/metis-go-live.sh billing 0x<your wallet>)}"
  local fa; fa="$(facilitator_address || true)"
  if [ -n "$fa" ]; then say "x402 key   $fa   $(metis "$fa") METIS   (needs >= 0.03 to deploy the proxy; ~0.25 to run)"; else say "x402 key   not created yet (scripts/metis-go-live.sh x402-key)"; fi
  say "x402 proxy $PROXY   $(has_code $PROXY && echo deployed || echo 'not deployed')"
  say "x402 on    $(vm_has X402_METIS_ENABLED)   /api/x402/metis/supported → $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://sagepays.xyz/api/x402/metis/supported)"
  say "accounts   TREASURY_CHAIN_ID on server: $(vm_get TREASURY_CHAIN_ID | grep . || echo 'not set')"
  # Read the page first, then match: under pipefail, `curl | grep -q` fails whenever grep stops reading
  # early (curl gets SIGPIPE), which would report "open" for a page that says "opening".
  local home; home="$(curl -s --max-time 30 https://sagepays.xyz/ || true)"
  if [ -z "$home" ]; then say "site       could not read sagepays.xyz"
  elif grep -q 'opening on Metis' <<<"$home"; then say "site       Metis still shows as opening"
  else say "site       Metis is open for new jobs"; fi
}

case "${1:-status}" in
  status) status ;;

  factory)
    if [ "$(vm_has METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS)" = yes ]; then say "The server already has a Metis factory set. Nothing to do."; exit 0; fi
    ADDR="$(rec_get METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS)"
    if [ -n "$ADDR" ]; then
      say "This Mac already deployed the factory at $ADDR ($REC); setting it on the server, not deploying again."
    else
      say "Operator $OPERATOR holds $(metis $OPERATOR) METIS. The deploy costs about 0.03 METIS."
      ask "Deploy the CampaignVaultFactory on Metis now (a real transaction from the operator), then set it on the server?"
      # Keep the output even if the deploy script stops after sending, so an address it printed is never lost.
      OUT="$(bash contracts/script/deploy-campaign-factory-metis.sh 2>&1 | tee /dev/stderr)" || true
      ADDR="$( { printf '%s\n' "$OUT" | grep -oE 'METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS=0x[0-9a-fA-F]{40}' || true; } | head -1 | cut -d= -f2)"
      [ -n "$ADDR" ] || ADDR="$( { printf '%s\n' "$OUT" | grep -iE 'Deployed to:' || true; } | grep -oiE '0x[0-9a-fA-F]{40}' | head -1 || true)"
      [ -n "$ADDR" ] || { say "No factory address in the output above; the server was not changed."; exit 1; }
      rec_set METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS "$ADDR"
    fi
    has_code "$ADDR" || { say "There is no contract at $ADDR on Metis; the server was not changed."; exit 1; }
    vm_set METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS "$ADDR"
    vm_set METIS_MAINNET_OPERATOR_ADDRESS "$OPERATOR"
    # New accounts open on Metis from now on (the server still says GOAT from before the pause).
    [ "$(vm_get TREASURY_CHAIN_ID)" = 1088 ] || vm_set TREASURY_CHAIN_ID 1088
    restart
    status
    say "Next: scripts/metis-go-live.sh identity"
    ;;

  identity)
    if [ "$(vm_has ERC8004_METIS_AGENT_ID)" = yes ]; then say "The server already has Sage's Metis identity. Nothing to do."; exit 0; fi
    if grep -qE '^ERC8004_METIS_AGENT_ID=' .env 2>/dev/null; then
      say "This Mac already registered Sage on Metis (ERC8004_METIS_AGENT_ID in .env); copying it to the server, not registering again."
    else
      ask "Register Sage's ERC-8004 identity on Metis now (one transaction from the operator, ~0.005 METIS)?"
      node scripts/register-erc8004.mjs --chain metis --uri https://sagepays.xyz/api/agent/card Sage
      grep -qE '^ERC8004_METIS_AGENT_ID=' .env || { say "No agent id was written to .env (see the output above); the server was not changed."; exit 1; }
    fi
    for name in ERC8004_METIS_AGENT_ID ERC8004_METIS_AGENT_ADDRESS ERC8004_METIS_AGENT_NAME; do
      v="$( { grep -E "^$name=" .env || true; } | tail -1 | cut -d= -f2- | tr -d '"')"
      [ -n "$v" ] && vm_set "$name" "$v"
    done
    restart
    say "Next: scripts/metis-go-live.sh billing 0x<your wallet>"
    ;;

  billing)
    addr="${2:-}"
    [[ "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || { say "usage: scripts/metis-go-live.sh billing 0x<your wallet address>"; exit 1; }
    # Revenue goes to a wallet only the founder holds, never to one of Sage's hot wallets.
    lower() { printf '%s' "$1" | tr 'A-F' 'a-f'; }
    fa="$(facilitator_address || true)"
    for hot in "$OPERATOR" "$fa"; do
      if [ -n "$hot" ] && [ "$(lower "$addr")" = "$(lower "$hot")" ]; then
        say "REFUSED: $addr is one of Sage's own hot wallets (its key is on a server). Use a wallet only you hold."; exit 1
      fi
    done
    ask "Send plan payments and Metis x402 sales to $addr?"
    vm_set SAGE_BILLING_ADDRESS "$addr"
    restart
    say "Next: scripts/metis-go-live.sh x402-key"
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
    # The facilitator settles only Sage's own sales by default (src/lib/x402/metis/config.ts), so with no
    # payee it would be on and settle nothing. Set where Sage is paid first.
    [ -n "$(vm_get X402_METIS_PAY_TO)$(vm_get SAGE_BILLING_ADDRESS)" ] || { say "Set where Sage is paid first: scripts/metis-go-live.sh billing 0x<your wallet>"; exit 1; }
    say "Facilitator $fa holds $(metis "$fa") METIS."
    S "cd $R && node contracts/script/deploy-x402-permit2-proxy-metis.mjs"
    if ! has_code $PROXY; then
      ask "Deploy the Permit2 proxy now (a real transaction from the facilitator, ~0.011 METIS)?"
      S "cd $R && node contracts/script/deploy-x402-permit2-proxy-metis.mjs --send"
      has_code $PROXY || { say "The proxy isn't on chain yet; x402 was not switched on. Run this step again in a minute."; exit 1; }
    fi
    vm_set X402_METIS_PERMIT2_PROXY_ADDRESS "$PROXY"
    vm_set X402_METIS_ENABLED 1
    restart
    say "  /api/x402/metis/supported → $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://sagepays.xyz/api/x402/metis/supported)"
    say "  Sage's own tools on Metis: https://sagepays.xyz/mcp/metis/sage_first_look (402 until paid; paid to the billing address)"
    say "  First real payment: PAYER_KEY=0x… node scripts/x402-metis-pay.mjs sage_first_look '{\"url\":\"https://sagepays.xyz\"}' --approve"
    ;;

  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
