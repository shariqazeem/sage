#!/usr/bin/env bash
#
# One-shot Telegram wiring for Sage's Payout Deputy (see docs/TELEGRAM.md).
#
# Registers the webhook, validates the token, and publishes the command menu.
# Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and NEXT_PUBLIC_APP_URL
# from .env (or a file passed as $1).
#
# IMPORTANT: run this from a network that can reach api.telegram.org. Some
# networks/regions block Telegram — a VPN, or running it from the deploy host,
# resolves that. The deployed app's own egress reaches Telegram for sends.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN in .env}"
: "${TELEGRAM_WEBHOOK_SECRET:?set TELEGRAM_WEBHOOK_SECRET in .env}"
: "${NEXT_PUBLIC_APP_URL:?set NEXT_PUBLIC_APP_URL in .env (your public https deploy)}"

API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
HOOK="${NEXT_PUBLIC_APP_URL%/}/api/telegram/webhook"

echo "→ getMe (validate token)"
curl -fsS "$API/getMe"; echo; echo

echo "→ setWebhook: $HOOK"
curl -fsS "$API/setWebhook" \
  --data-urlencode "url=$HOOK" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","channel_post"]' \
  -d "drop_pending_updates=true"; echo; echo

echo "→ setMyCommands (menu)"
curl -fsS "$API/setMyCommands" --data-urlencode 'commands=[
  {"command":"status","description":"Public stats for a campaign: /status <slug>"},
  {"command":"agent","description":"Sage'\''s on-chain track record"},
  {"command":"start","description":"Get a campaign link"},
  {"command":"help","description":"Show the commands"}
]'; echo; echo

echo "→ getWebhookInfo (confirm)"
curl -fsS "$API/getWebhookInfo"; echo; echo
echo "done — message the bot /agent to smoke-test."
