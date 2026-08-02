#!/bin/sh
set -eu

REPORT=${1:?Usage: assert-doctor-continuity-warning.sh <doctor-report>}

grep -Fq '"status": "warning"' "$REPORT"
awk '
  /"administratorContinuity":/ { active = 1; next }
  active && /"ok": true/ { healthy = 1 }
  active && /"warning": true/ { warning = 1 }
  active && /^    "[a-z]/ { exit }
  END { exit (healthy && warning) ? 0 : 1 }
' "$REPORT"
