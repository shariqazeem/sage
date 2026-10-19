#!/bin/bash
# Deploy a file list to prod without a rebuild window: guard → sync each file (ssh cat, quoted path)
# → retire removed files → checksum every file on prod → build into .next-new → swap → restart → verify.
#   scripts/deploy-prod.sh <file-list> [removed-list]
#     file-list:    one repo-relative path per line (defaults to /tmp/deploy-next.txt)
#     removed-list: files deleted in the repo. They are MOVED on prod to ~/sage-retired/<time>/ (never
#                   deleted, so a bad deploy can put them back), so a removed page stops being built.
# Never run while a battery is running on the VM. Contains no secrets; the key path is the operator's.
set -u
LIST="${1:-/tmp/deploy-next.txt}"
REMOVED="${2:-}"
KEY=~/Documents/ssh-key3.key; VM=ubuntu@80.225.209.190; R=/home/ubuntu/sage
S() { ssh -n -o StrictHostKeyChecking=no -i $KEY $VM "$@"; }
cd "$(dirname "$0")/.."
if S 'pgrep -f "^node scripts/mission-eval-matri[x]" >/dev/null || pgrep -f "npm exe[c] vitest" >/dev/null || pgrep -f "node \(vites[t]" >/dev/null'; then echo "ABORT: a battery is running on the VM"; exit 2; fi
echo "== guard: pending/settling submissions =="
cat > /tmp/guard.cjs <<'JS'
const db = require("/home/ubuntu/sage/node_modules/better-sqlite3")("/home/ubuntu/sage/var/sage.db", { readonly: true });
// settling, or pending with NO decision yet (mid-judgment) — a held submission (pending + a decision row) is
// stable across a restart and must not block a deploy for as long as a founder takes to review it.
const rows = db.prepare(`select s.status, count(*) as n from submissions s left join decisions d on d.submission_id = s.id
  where s.status = 'settling' or (s.status = 'pending' and d.id is null) group by s.status`).all();
console.log(JSON.stringify(rows)); process.exit(rows.length ? 1 : 0);
JS
ssh -o StrictHostKeyChecking=no -i $KEY $VM "cat > /home/ubuntu/guard.cjs" < /tmp/guard.cjs
S "node /home/ubuntu/guard.cjs" || { echo "ABORT: pending/settling work"; exit 3; }
echo "== sync $(wc -l < "$LIST" | tr -d ' ') files (one tar stream, one connection) =="
# One connection for the whole list: an ssh per file exhausted the Mac's local ports at ~200 files
# ("Can't assign requested address", 19 Oct 2026). COPYFILE_DISABLE + --no-mac-metadata keep macOS
# from adding AppleDouble files and xattr headers that Linux tar would warn about.
fail=0
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -cf - -T "$LIST" | ssh -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && tar -xf - --no-same-owner" || { echo "SYNC FAILED"; fail=1; }
[ $fail = 0 ] || exit 4
if [ -n "$REMOVED" ] && [ -s "$REMOVED" ]; then
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  echo "== retire $(wc -l < "$REMOVED" | tr -d ' ') removed files → ~/sage-retired/$STAMP =="
  while read -r f; do [ -z "$f" ] && continue; case "$f" in /*|*..*) echo "REFUSED path: $f"; exit 4;; esac; done < "$REMOVED"
  # One connection: each path is moved aside (kept, never deleted), then every one is checked gone,
  # because a removed file still present is still built and still served.
  ssh -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && while read -r f; do [ -z \"\$f\" ] && continue; if [ -e \"\$f\" ]; then mkdir -p \"/home/ubuntu/sage-retired/$STAMP/\$(dirname \"\$f\")\" && mv \"\$f\" \"/home/ubuntu/sage-retired/$STAMP/\$f\" || exit 1; fi; done; " < "$REMOVED" || { echo "RETIRE FAILED"; exit 4; }
  left=$(ssh -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && while read -r f; do [ -n \"\$f\" ] && [ -e \"\$f\" ] && echo \"\$f\"; done; true" < "$REMOVED")
  [ -z "$left" ] || { echo "STILL PRESENT:"; echo "$left"; exit 4; }
fi
echo "== checksums =="
while read -r f; do [ -z "$f" ] && continue; echo "$(md5 -q "$f")  $f"; done < "$LIST" > /tmp/deploy-local.md5
ssh -o StrictHostKeyChecking=no -i $KEY $VM "cd $R && while read -r sum f; do echo \"\$(md5sum \"\$f\" | cut -d' ' -f1)  \$f\"; done" < /tmp/deploy-local.md5 > /tmp/deploy-remote.md5
if diff -q /tmp/deploy-local.md5 /tmp/deploy-remote.md5 >/dev/null; then echo "all $(wc -l < /tmp/deploy-local.md5 | tr -d ' ') checksums match"; else echo "CHECKSUM MISMATCH:"; diff /tmp/deploy-local.md5 /tmp/deploy-remote.md5; exit 5; fi
echo "== build (into .next-new; the live server keeps .next) =="
# The live build's generated route types (.next/types) are part of the type-check (tsconfig includes them)
# but describe the routes as they WERE: a deploy that removes a page failed on them ("Cannot find module
# …/caribbean/page.js", 19 Oct 2026). The running server never reads them, so they are set aside for the
# build and put back if it fails, leaving the live server exactly as it was.
S "cd $R && rm -rf .next-types-prev && { [ -d .next/types ] && mv .next/types .next-types-prev || true; } && rm -rf .next-new && NEXT_DIST_DIR=.next-new npm run build 2>&1 | tail -4 && test -f .next-new/BUILD_ID" || { S "cd $R && [ -d .next-types-prev ] && [ ! -d .next/types ] && mv .next-types-prev .next/types; true"; echo "BUILD FAILED (live server untouched)"; exit 6; }
S "cd $R && rm -rf .next-types-prev"
echo "== swap + restart =="
S "cd $R && rm -rf .next-prev && mv .next .next-prev && mv .next-new .next && pm2 restart sage --update-env >/dev/null && sleep 6 && pm2 status sage | grep -E 'sage ' | awk -F'│' '{print \"pm2:\", \$3, \$10}' && rm -rf .next-prev"
echo "== verify =="
for p in / /pricing /company /ledger /docs /marketplace /launch /start /lender /explorer /faq; do printf "%s → " "$p"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 30 "https://sagepays.xyz$p"; done
S "tail -3 /home/ubuntu/.pm2/logs/sage-error.log | cut -c1-160"
