#!/bin/sh
set -eu

fail() {
  printf '%s\n' "release asset cleanup smoke failed: $*" >&2
  exit 1
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
mkdir -p "$work_dir/bin"
printf '%s\n' present > "$work_dir/state"
printf '%s\n' 0 > "$work_dir/queries"

cat > "$work_dir/bin/gh" <<'EOF'
#!/bin/sh
set -eu

if [ "${1:-}" != api ]; then exit 2; fi
if [ "${2:-}" = --method ] && [ "${3:-}" = DELETE ]; then
  if [ "${FAKE_DELETE_FAIL:-false}" = true ]; then exit 1; fi
  printf '%s\n' absent > "$FAKE_RELEASE_STATE"
  exit 0
fi

queries=$(cat "$FAKE_QUERY_COUNT")
printf '%s\n' $((queries + 1)) > "$FAKE_QUERY_COUNT"
if [ "${FAKE_QUERY_FAIL_ONCE:-false}" = true ] && [ "$queries" -eq 0 ]; then exit 1; fi
if [ "$(cat "$FAKE_RELEASE_STATE")" = present ]; then
  printf '%s\n' '{"assets":[{"id":42,"name":"nextbuf-v1.0.0-release-complete.txt"}]}'
else
  printf '%s\n' '{"assets":[]}'
fi
EOF
chmod +x "$work_dir/bin/gh"
PATH="$work_dir/bin:$PATH"
export PATH
FAKE_RELEASE_STATE="$work_dir/state"
FAKE_QUERY_COUNT="$work_dir/queries"
FAKE_QUERY_FAIL_ONCE=true
export FAKE_RELEASE_STATE FAKE_QUERY_COUNT FAKE_QUERY_FAIL_ONCE

NEXTBUF_RELEASE_ASSET_DELETE_RETRIES=4 \
NEXTBUF_RELEASE_ASSET_DELETE_RETRY_DELAY_SECONDS=0 \
  sh "$root/scripts/delete-github-release-asset.sh" \
    owner/repository v1.0.0 nextbuf-v1.0.0-release-complete.txt >/dev/null
[ "$(cat "$work_dir/state")" = absent ] || fail 'receipt remained after a retryable API failure'

printf '%s\n' present > "$work_dir/state"
printf '%s\n' 0 > "$work_dir/queries"
FAKE_QUERY_FAIL_ONCE=false
FAKE_DELETE_FAIL=false
export FAKE_QUERY_FAIL_ONCE FAKE_DELETE_FAIL
NEXTBUF_RELEASE_ASSET_DELETE_RETRIES=1 \
NEXTBUF_RELEASE_ASSET_DELETE_RETRY_DELAY_SECONDS=0 \
  sh "$root/scripts/delete-github-release-asset.sh" \
    owner/repository v1.0.0 nextbuf-v1.0.0-release-complete.txt >/dev/null
[ "$(cat "$work_dir/state")" = absent ] \
  || fail 'a successful final deletion attempt was reported as failed'

printf '%s\n' present > "$work_dir/state"
printf '%s\n' 0 > "$work_dir/queries"
FAKE_QUERY_FAIL_ONCE=false
FAKE_DELETE_FAIL=true
export FAKE_QUERY_FAIL_ONCE FAKE_DELETE_FAIL
if NEXTBUF_RELEASE_ASSET_DELETE_RETRIES=2 \
  NEXTBUF_RELEASE_ASSET_DELETE_RETRY_DELAY_SECONDS=0 \
  sh "$root/scripts/delete-github-release-asset.sh" \
    owner/repository v1.0.0 nextbuf-v1.0.0-release-complete.txt >/dev/null 2>&1; then
  fail 'persistent receipt deletion failure was hidden'
fi

printf '%s\n' 'release asset cleanup smoke passed'
