#!/usr/bin/env bash
# The quality gate, in one place — because reading the wrong line let a red suite deploy.
#
# vitest reports failures on TWO lines and they do not always agree: a file that fails to LOAD
# (a bad import, a stylesheet dragging PostCSS into a component test) shows up as
#   Test Files  2 failed | 426 passed
#   Tests       4270 passed          ← no "failed" at all, because its tests never ran
# Checking only the Tests line called that a pass and shipped it. Both lines, every time.
set -uo pipefail
cd "$(dirname "$0")/.."
out=${1:-/tmp/gate-vitest.txt}

npm run -s lint > /tmp/gate-lint.txt 2>&1 || { echo "LINT FAILED"; tail -20 /tmp/gate-lint.txt; exit 1; }
echo "lint ok"
npm run -s typecheck > /tmp/gate-tc.txt 2>&1 || { echo "TYPECHECK FAILED"; head -20 /tmp/gate-tc.txt; exit 1; }
echo "typecheck ok"

npx vitest run > "$out" 2>&1
files_line=$(grep -E "^\s*Test Files" "$out" | tail -1)
tests_line=$(grep -E "^\s*Tests " "$out" | tail -1)
echo "$files_line"
echo "$tests_line"
if echo "$files_line" | grep -q "failed" || echo "$tests_line" | grep -q "failed"; then
  echo "TESTS FAILED"
  grep -E "FAIL |Failed to load|Transform failed" "$out" | head -12
  exit 1
fi
echo "tests ok"
