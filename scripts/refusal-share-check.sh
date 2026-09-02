#!/bin/bash
# The refusal rate as each public page renders it — after a deploy they must all agree.
# (Finding 15: explorer 43%, landing and outcomes 44%, launch 50% on the same day.)
BASE="${1:-https://sagepays.xyz}"
get() { curl -s --max-time 30 "$BASE$1"; }
landing=$(get / | python3 -c "import sys,re,html;s=sys.stdin.read();m=re.search(r'class=\"tr-v\">([^<]*· [0-9]+%)<',s);print(html.unescape(m.group(1)) if m else '?')")
explorer=$(get /explorer | python3 -c "import sys,re;s=sys.stdin.read();m=re.search(r'exp-stat-v\">([0-9]+)(?:<!-- -->)?%</div><div class=\"exp-stat-k\">Refusal share',s);print((m.group(1)+'%') if m else '?')")
outcomes=$(get /outcomes | python3 -c "import sys,re;s=sys.stdin.read();m=re.search(r'([0-9]+)(?:<!-- -->)?% of decided work',s);print((m.group(1)+'%') if m else '?')")
launch=$(get /launch | python3 -c "import sys,re;s=sys.stdin.read();m=re.search(r'(?:Refused on record|Not paid out)</dt><dd>([0-9]+)(?:<!-- -->)?%',s);print((m.group(1)+'%') if m else '?')")
echo "landing  : $landing"
echo "explorer : $explorer"
echo "outcomes : $outcomes"
echo "launch   : $launch"
