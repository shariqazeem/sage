# Runbook — a quality round on the agentic lanes

One battery at a time on the VM, nothing else running there (builds contend for the 2 cores and
read as timeouts). Every battery runs DETACHED with a VM-local log — the ssh relay goes silent.

```bash
# on the VM, after `set -a; . ./.env; set +a`
nohup node scripts/mission-eval-matrix.mjs --nonce N > /tmp/pgenN.log 2>&1 < /dev/null &   # P-GEN (nonce < 100, unburned)
DIRECT_EVAL=1 DIRECT_RUNS=1 DIRECT_DUMP=1 nohup npx vitest run direct-eval.live > /tmp/pdirect-dump.log 2>&1 < /dev/null &
WORK_EVAL=1 WORK_RUNS=2 nohup npx vitest run work-eval.live > /tmp/pwork.log 2>&1 < /dev/null &
JUDGE_EVAL=1 JUDGE_RUNS=2 nohup npx vitest run judge-eval.live > /tmp/pjudge.log 2>&1 < /dev/null &
```

Stop a run without killing your own shell: `pkill -f "^node scripts/mission-eval-matrix"` (anchored —
an unanchored pattern matches the ssh session's command string and the session dies).

**Read the plans, not the cells.** A green grid hid three defects on 2 Sep. After P-GEN, dump the
newest jobs' missions (title · reward × count · effort · class · criteria) and read three end to end
as a founder would: is each mission about THIS product, verifiable, fairly priced for its effort,
and does the plan cover the product's distinct flows? After P-DIRECT with `DIRECT_DUMP=1`, read the
compiled contracts in words. Fix what reading exposes, then re-run the battery the change touches —
a mission-brain change is not done until P-GEN's anchors are 100% again.

Burned nonces are listed in memory (`agent-quality-round-2`); 42–45 burned on 2 Sep.
