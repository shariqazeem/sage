#!/bin/bash
# The live public numbers, read from the site the way a judge would — for the T-2h refresh of the
# packages and the video captions marked LIVE. Read-only; prints one line per surface.
BASE="${1:-https://sagepays.xyz}"
html=$(curl -s --max-time 30 "$BASE/")
echo "landing facts strip:"
settled=$(echo "$html" | grep -o '\$[0-9][0-9,.]*' | head -1)
payouts=$(echo "$html" | grep -o 'settled[^}]\{0,200\}children\\":[0-9]\+' | head -1 | grep -o '[0-9]\+$')
refused=$(echo "$html" | grep -o '[0-9]\+ · [0-9]\+%' | head -1)
echo "  settled $settled · verified payouts ${payouts:-?} · refused on record ${refused:-?}"
echo "outcomes:"; curl -s --max-time 30 "$BASE/outcomes" | grep -o 'Not yet measured\|NOT YET MEASURED' | sort | uniq -c | sed 's/^/  gaps: /'
echo "strk20 manifest:"; curl -s --max-time 20 "$BASE/strk20.json" | python3 -c "import sys,json;m=json.load(sys.stdin);print('  contracts',len(m['contracts']),'· transactions',len(m['transactions']))"
