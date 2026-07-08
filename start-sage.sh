#!/usr/bin/env bash
# Start Sage with its .env explicitly loaded into the process environment.
#
# `next start` launched via `pm2 start npm -- start` did NOT reliably load .env,
# so the LLM key, SAGE_SESSION_SECRET, and DEPUTY_MODEL were missing at runtime —
# the brain silently fell back to the heuristic and sign-in used the dev secret.
# Sourcing .env here guarantees every restart AND every reboot (pm2 resurrect)
# has the full environment.
#
# Run under pm2:  pm2 start ./start-sage.sh --name sage --interpreter bash
set -a
# shellcheck disable=SC1091
[ -f "$(dirname "$0")/.env" ] && . "$(dirname "$0")/.env"
set +a
cd "$(dirname "$0")"
exec npx next start -p 3000
