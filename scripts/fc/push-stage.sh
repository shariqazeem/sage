#!/bin/bash
# Push the Demo Day deck's edited files to prod WITHOUT a rebuild, then prove the site serves them.
#   scripts/fc/push-stage.sh
# Next serves an existing public/ file's new content at request time (measured 6 Oct 2026); only a NEW
# file name needs a build, so the deck's file set is fixed: index.html, config.js, shop.html, assets/*. Static
# files only: no restart, nothing that moves money. Contains no secrets; the key path is the operator's.
set -u
KEY=~/Documents/ssh-key3.key; VM=ubuntu@80.225.209.190; R=/home/ubuntu/sage
cd "$(dirname "$0")/../.."
fail=0
for f in public/stage/index.html public/stage/config.js public/stage/shop.html; do
  ssh -o StrictHostKeyChecking=no -i $KEY $VM "cat > '$R/$f'" < "$f" || { echo "SYNC FAILED: $f"; fail=1; continue; }
  url="https://sagepays.xyz/${f#public/}"
  l=$(md5 -q "$f"); v=$(ssh -i $KEY $VM "md5sum '$R/$f' | cut -d' ' -f1"); s=$(curl -s -m 30 "$url?v=$RANDOM" | md5)
  if [ "$l" = "$v" ] && [ "$l" = "$s" ]; then echo "ok    $url"; else echo "STALE $url (local $l · vm $v · served $s)"; fail=1; fi
done
exit $fail
