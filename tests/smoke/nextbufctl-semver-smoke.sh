#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DEFINITIONS=$(mktemp "${TMPDIR:-/tmp}/nextbufctl-definitions.XXXXXX")
trap 'rm -f "$DEFINITIONS"' EXIT HUP INT TERM

sed '/^command_name=/,$d' "$ROOT/nextbufctl" >"$DEFINITIONS"
# shellcheck disable=SC1090
. "$DEFINITIONS"

assert_comparison() {
  left=$1
  right=$2
  expected=$3
  actual=$(semver_compare "$left" "$right")
  [ "$actual" = "$expected" ] || {
    printf 'Expected %s compared with %s to be %s, received %s\n' \
      "$left" "$right" "$expected" "$actual" >&2
    exit 1
  }
}

assert_comparison 0.13.8 0.13.9 -1
assert_comparison 0.13.9 0.13.10 -1
assert_comparison 1.0.0-rc.1 1.0.0 -1
assert_comparison 1.0.0 1.0.0-rc.1 1
assert_comparison 1.0.0-rc.1 1.0.0-rc.2 -1
assert_comparison 1.0.0-rc.2 1.0.0-rc.10 -1
assert_comparison 1.0.0 1.0.1 -1
assert_comparison 1.0.1 1.0.2 -1
assert_comparison 1.0.0 1.0.0 0
assert_comparison 999999999999999999999999.0.0 1000000000000000000000000.0.0 -1
assert_comparison 1.0.0-999999999999999999999999 1.0.0-1000000000000000000000000 -1

is_exact_semver 1.0.0
is_exact_semver 1.0.0-rc.1
if is_exact_semver 01.0.0 || is_exact_semver 1.0 || is_exact_semver 1.0.0+build.1 || is_exact_semver 1.0.0-01; then
  printf 'Invalid or unsupported image SemVer was accepted\n' >&2
  exit 1
fi

printf 'nextbufctl SemVer comparisons passed.\n'
