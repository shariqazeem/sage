#!/bin/bash
# The live public numbers, read from the site the way a judge would — for the T-2h refresh of the
# packages and the video captions marked LIVE. Read-only; prints one line per surface.
BASE="${1:-https://sagepays.xyz}"
html=$(curl -s --max-time 30 "$BASE/")
echo "landing facts strip (server-rendered, read from the ledger):"
echo "$html" | python3 -c "
import sys,re,html as h
s=sys.stdin.read()
ks=re.findall(r'class=\"tr-k mono\">([^<]*)<', s); vs=re.findall(r'class=\"tr-v\">([^<]*)<', s)
for k,v in zip(ks,vs): print('  ' + h.unescape(k) + ': ' + h.unescape(v))"
echo "outcomes:"; curl -s --max-time 30 "$BASE/outcomes" | grep -o 'Not yet measured\|NOT YET MEASURED' | sort | uniq -c | sed 's/^/  gaps: /'
echo "strk20 manifest:"; curl -s --max-time 20 "$BASE/strk20.json" | python3 -c "import sys,json;m=json.load(sys.stdin);print('  contracts',len(m['contracts']),'· transactions',len(m['transactions']))"
