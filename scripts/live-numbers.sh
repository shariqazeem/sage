#!/bin/bash
# The live public numbers, read from the site the way a judge would — for the T-2h refresh of the
# packages and the video captions marked LIVE. Read-only; prints one line per surface.
BASE="${1:-https://sagepays.xyz}"
txt() { python3 -c "
import sys,re,html
t=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',re.sub(r'<script.*?</script>|<style.*?</style>','',sys.stdin.read(),flags=re.S))))
print(t)"; }
echo "landing facts strip (server-rendered, read from the ledger):"
curl -s --max-time 30 "$BASE/" | txt | grep -oE '\$[0-9.,]+ settled · [0-9]+ verified payout ?s? · [0-9]+ refused · [^·]{0,40}' | head -1 | sed 's/^/  /'
echo "marketplace (testers only):"
curl -s --max-time 30 "$BASE/marketplace" | txt | grep -oE '[0-9]+ payouts to [0-9]+ people[^.]*|\$[0-9.,]+ paid to testers so far|[0-9]+m [0-9]+s median wait, measured over [0-9]+ payouts' | sed 's/^/  /'
echo "outcomes (the track's bar):"
curl -s --max-time 30 "$BASE/outcomes" | txt | grep -oE '\$[0-9.,]+ settled autonomously across [0-9]+ payouts, from [0-9]+ funders?|[0-9]+ people paid|[0-9]+ submissions refused \( ?[0-9]+ ?% of decided work\)|[0-9]+ min median|Sage \$[0-9.]+ Corridor \$[0-9.]+|Not yet measured' | sort | uniq -c | sed 's/^/  /'
echo "explorer:"
curl -s --max-time 30 "$BASE/explorer" | txt | grep -ioE '\$[0-9.,]+ settled, verified|[0-9]+ mainnet payouts|[0-9]+ refusals on record|[0-9]+ ?% refusal share' | sed 's/^/  /'
echo "launch page (tester supply):"
curl -s --max-time 30 "$BASE/launch" | txt | grep -oE '[0-9]+ people have been paid[^—]{0,60}|\$ ?[0-9.,]+ USDC settled on-chain|Missions paid [0-9]+|Typical time to payout [0-9a-z ]+|Refused on record [0-9]+ ?%' | sed 's/^/  /'
echo "strk20 manifest:"; curl -s --max-time 20 "$BASE/strk20.json" | python3 -c "import sys,json;m=json.load(sys.stdin);print('  contracts',len(m['contracts']),'· transactions',len(m['transactions']),'· demo_video', 'set' if m.get('demo_video') else 'MISSING')"
