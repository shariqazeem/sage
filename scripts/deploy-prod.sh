#!/bin/bash
# Deploy a file list to prod without a rebuild window: guard → sync each file (ssh cat, quoted path)
# → checksum every file on prod → build into .next-new → swap → restart → verify.
#   scripts/deploy-prod.sh <file-list>     (one repo-relative path per line; defaults to /tmp/deploy-next.txt)
# Never run while a battery is running on the VM. Contains no secrets; the key path is the operator's.
set -u
LIST="${1:-/tmp/deploy-next.txt}"
KEY=~/Documents/ssh-key3.key; VM=ubuntu@80.225.209.190; R=/home/ubuntu/sage
S() { ssh -n -o StrictHostKeyChecking=no -i $KEY $VM "$@"; }
cd "$(dirname "$0")/.."
if S 'pgrep -f "^node scripts/mission-eval-matri[x]" >/dev/null || pgrep -f "npm exe[c] vitest" >/dev/null || pgrep -f "node \(vites[t]" >/dev/null'; then echo "ABORT: a battery is running on the VM"; exit 2; fi
echo "== guard: pending/settling submissions =="
cat > /tmp/guard.cjs <<'JS'
const db = require("/home/ubuntu/sage/node_modules/better-sqlite3")("/home/ubuntu/sage/var/sage.db", { readonly: true });
const rows = db.prepare("select status, count(*) as n from submissions where status in ('pending','settling') group by status").all();
console.log(JSON.stringify(rows)); process.exit(rows.length ? 1 : 0);
JS
ssh -o StrictHostKeyChecking=no -i $KEY $VM "cat > /home/ubuntu/guard.cjs" < /tmp/guard.cjs
S "node /home/ubuntu/guard.cjs" || { echo "ABORT: pending/settling work"; exit 3; }
echo "== sync $(wc -l < "$LIST" | tr -d ' ') files =="
fail=0
while read -r f; do
  [ -z "$f" ] && continue
  ssh -o StrictHostKeyChecking=no -i $KEY $VM "mkdir -p '$R/$(dirname "$f")' && cat > '$R/$f'" < "$f" || { echo "SYNC FAILED: $f"; fail=1; }
done < "$LIST"
[ $fail = 0 ] || exit 4
echo "== checksums =="
while read -r f; do [ -z "$f" ] && continue; echo "$(md5 -q "$f")  $f"; done < "$LIST" > /tmp/deploy-local.md5
ssh -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && while read -r sum f; do echo \"\$(md5sum \"\$f\" | cut -d' ' -f1)  \$f\"; done" < /tmp/deploy-local.md5 > /tmp/deploy-remote.md5
if diff -q /tmp/deploy-local.md5 /tmp/deploy-remote.md5 >/dev/null; then echo "all $(wc -l < /tmp/deploy-local.md5 | tr -d ' ') checksums match"; else echo "CHECKSUM MISMATCH:"; diff /tmp/deploy-local.md5 /tmp/deploy-remote.md5; exit 5; fi
echo "== build (into .next-new; the live server keeps .next) =="
S "cd $R && rm -rf .next-new && NEXT_DIST_DIR=.next-new npm run build 2>&1 | tail -4 && test -f .next-new/BUILD_ID" || { echo "BUILD FAILED (live server untouched)"; exit 6; }
echo "== swap + restart =="
S "cd $R && rm -rf .next-prev && mv .next .next-prev && mv .next-new .next && pm2 restart sage --update-env >/dev/null && sleep 6 && pm2 status sage | grep -E 'sage ' | awk -F'│' '{print \"pm2:\", \$3, \$10}' && rm -rf .next-prev"
echo "== verify =="
for p in / /launch /explorer /marketplace /lender /outcomes /docs; do printf "%s → " "$p"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 30 "https://sagepays.xyz$p"; done
S "tail -3 /home/ubuntu/.pm2/logs/sage-error.log | cut -c1-160"
