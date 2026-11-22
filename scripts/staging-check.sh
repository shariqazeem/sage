#!/bin/bash
# THE LIVE CHECK BEFORE A DEPLOY, ON A THROWAWAY COPY OF PROD (22 Nov 2026).
#
# Any change to inspection, the field test, vision, the mission brain or the gates runs P-GEN before it
# deploys (CLAUDE.md). Doing that by hand on the VM went wrong in small ways every time: plain macOS tar
# left `._*` files that broke the build, `pkill -f` killed its own ssh, an EMPTY TELEGRAM_BOT_TOKEN failed
# env.ts while a missing one is fine, and a full battery spent a week's model credit. This script is the
# method that worked (memory: pgen-on-staging-copy), in one place:
#
#   scripts/staging-check.sh up [branch]           copy <branch> (default relaunch) to the VM, its own .env and
#                                                  database, build, start on :3100. Spends no model credit.
#   scripts/staging-check.sh probe [--answer]      which models answer (llm-route.mjs probe with prod's own keys):
#                                                  a fraction of a cent, a few cents with --answer
#   scripts/staging-check.sh pgen <nonce> [flags]  P-GEN against :3100 in the background (flags go to
#                                                  mission-eval-matrix.mjs: --only <category>, --kinds, --job <id>)
#   scripts/staging-check.sh watch <nonce>         the log so far, and the grid once it is printed
#   scripts/staging-check.sh down                  keep the logs in prod's var/, stop and delete the copy
#
# The copy has its own spend ceiling, STAGING_BUDGET_USD (default 2), read by its own meter
# (LLM_DAILY_BUDGET_USD): past it, the copy's model calls are refused like an empty account, so a battery can
# never spend more than that. An architect P-GEN row costs about $0.15-0.25. The copy never messages anyone:
# no Telegram bot token, X agent off, its own empty database, and nothing schedules its sweep.
set -euo pipefail
KEY=~/Documents/ssh-key3.key
VM=ubuntu@80.225.209.190
PROD=/home/ubuntu/sage
ST=/home/ubuntu/sage-staging
SSH=(ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=20 -o ServerAliveCountMax=15 -i "$KEY" "$VM")
cd "$(dirname "$0")/.."

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
  up)
    branch="${1:-relaunch}"
    budget="${STAGING_BUDGET_USD:-2}"
    git rev-parse --verify --quiet "$branch" > /dev/null || { echo "no branch or commit named $branch"; exit 2; }
    if "${SSH[@]}" "test -e $ST"; then echo "a staging copy already exists at $ST: run 'down' first"; exit 2; fi
    echo "copying $branch ($(git rev-parse --short "$branch")) to $ST"
    "${SSH[@]}" "mkdir -p $ST"
    # git archive carries only tracked files: no ._* files, no local edits, no secrets
    git archive "$branch" | "${SSH[@]}" "tar -x -C $ST --no-same-owner"
    "${SSH[@]}" "set -e
      cd $ST
      cp -al $PROD/node_modules node_modules
      mkdir -p contracts/out var
      for d in CampaignVault.sol CampaignVaultFactory.sol; do [ -e $PROD/contracts/out/\$d ] && cp -r $PROD/contracts/out/\$d contracts/out/; done
      grep -v -E '^(SAGE_DB_PATH|LLM_DAILY_BUDGET_USD|LLM_SPEND_PATH|X_AGENT|TELEGRAM_BOT_TOKEN)=' $PROD/.env > .env
      printf 'SAGE_DB_PATH=$ST/var/staging.db\nLLM_DAILY_BUDGET_USD=$budget\nLLM_SPEND_PATH=$ST/var/llm-spend.json\nX_AGENT=off\n' >> .env
      chmod 600 .env
      echo 'building (a few minutes)'
      npm run build > var/build.log 2>&1 || { tail -40 var/build.log; exit 1; }
      pm2 start npm --name sage-staging --cwd $ST -- start -- -p 3100 > /dev/null
      for i in \$(seq 1 45); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 2; done
      curl -s -o /dev/null -w 'staging / -> %{http_code}\n' http://localhost:3100/"
    echo "up: spend ceiling \$$budget on its own meter. Next: scripts/staging-check.sh probe, then pgen <nonce>"
    ;;

  probe)
    "${SSH[@]}" "cd $PROD && node scripts/vm/llm-route.mjs probe $*"
    ;;

  pgen)
    nonce="${1:-}"
    [ -n "$nonce" ] || { echo "usage: scripts/staging-check.sh pgen <nonce> [--only <category>] [--kinds] [--job <id>]"; exit 2; }
    shift
    # CLAUDE.md: a nonce of 100 or more moves budgets past the $10,000 cap and every row fails alike
    [[ "$nonce" =~ ^[0-9]+$ ]] && [ "$nonce" -lt 100 ] || { echo "the nonce must be a whole number below 100"; exit 2; }
    "${SSH[@]}" "test -e $ST" || { echo "no staging copy: run 'up' first"; exit 2; }
    "${SSH[@]}" "cd $ST && test ! -e var/pgen$nonce.log" || { echo "var/pgen$nonce.log exists on the copy: pick another nonce"; exit 2; }
    "${SSH[@]}" "cd $ST && setsid nohup node --env-file=.env scripts/mission-eval-matrix.mjs --base http://localhost:3100 --nonce $nonce $* > var/pgen$nonce.log 2>&1 < /dev/null & echo started"
    echo "running in the background. Check 'signed in as' and a non-zero token cost before believing any row:"
    echo "  scripts/staging-check.sh watch $nonce"
    ;;

  watch)
    nonce="${1:-}"
    [ -n "$nonce" ] || { echo "usage: scripts/staging-check.sh watch <nonce>"; exit 2; }
    "${SSH[@]}" "cd $ST 2>/dev/null && test -e var/pgen$nonce.log" || { echo "no log for nonce $nonce on the copy"; exit 2; }
    "${SSH[@]}" "cd $ST && head -2 var/pgen$nonce.log && echo ... && tail -40 var/pgen$nonce.log; echo; echo 'spend so far:'; node -e 'try{const s=require(\"$ST/var/llm-spend.json\");console.log(JSON.stringify(s).slice(0,400))}catch{console.log(\"(no spend file yet)\")}'"
    ;;

  down)
    if ! "${SSH[@]}" "test -e $ST"; then echo "no staging copy to remove"; exit 0; fi
    # keep every battery log beside prod's, named for where it ran; then the copy goes
    "${SSH[@]}" "set -e
      cd $ST
      for f in var/pgen*.log; do [ -e \"\$f\" ] && cp \"\$f\" $PROD/var/\$(basename \"\$f\" .log)-staging.log; done
      pm2 delete sage-staging > /dev/null 2>&1 || true
      cd /home/ubuntu
      [ \"$ST\" = /home/ubuntu/sage-staging ] && rm -rf /home/ubuntu/sage-staging
      echo 'the copy is gone; its logs are in $PROD/var/ as *-staging.log'"
    ;;

  *)
    sed -n '2,25p' "$0"
    exit 2
    ;;
esac
