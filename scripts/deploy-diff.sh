#!/bin/bash
# WHAT PROD IS MISSING, BY CHECKSUM. Prod has no git, so "what changed since the last deploy" is
# answered by comparing every deployable file's md5 here against the same path on the VM.
# Writes two lists for scripts/deploy-prod.sh:
#   /tmp/deploy-next.txt     files that differ or are missing on prod
#   /tmp/deploy-removed.txt  files under src/ (and drizzle/) on prod that the repo no longer has
#   scripts/deploy-diff.sh            read-only: it changes nothing on prod
set -u
KEY=~/Documents/ssh-key3.key; VM=ubuntu@80.225.209.190; R=/home/ubuntu/sage
cd "$(dirname "$0")/.."
PATHS="src public drizzle scripts contracts/script next.config.ts package.json package-lock.json tsconfig.json postcss.config.mjs eslint.config.mjs CLAUDE.md"
git ls-files $PATHS 2>/dev/null | while read -r f; do [ -f "$f" ] && echo "$(md5 -q "$f")  $f"; done > /tmp/deploy-all-local.md5
ssh -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && while read -r sum f; do if [ -f \"\$f\" ]; then echo \"\$(md5sum \"\$f\" | cut -d' ' -f1)  \$f\"; else echo \"missing  \$f\"; fi; done" < /tmp/deploy-all-local.md5 > /tmp/deploy-all-remote.md5
diff <(sort -k2 /tmp/deploy-all-local.md5) <(sort -k2 /tmp/deploy-all-remote.md5) | grep '^<' | sed 's/^< [^ ]*  //' > /tmp/deploy-next.txt
git ls-files src drizzle | sort > /tmp/deploy-tracked.txt
ssh -n -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && find src drizzle -type f | sort" > /tmp/deploy-prod-files.txt
comm -13 /tmp/deploy-tracked.txt /tmp/deploy-prod-files.txt > /tmp/deploy-removed.txt
echo "differ or missing on prod: $(wc -l < /tmp/deploy-next.txt | tr -d ' ')  → /tmp/deploy-next.txt"
echo "on prod, gone from the repo: $(wc -l < /tmp/deploy-removed.txt | tr -d ' ')  → /tmp/deploy-removed.txt"
