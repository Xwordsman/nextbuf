#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DEFINITIONS=$(mktemp "${TMPDIR:-/tmp}/nextbufctl-acceptance-definitions.XXXXXX")
WORK=$(mktemp -d "${TMPDIR:-/tmp}/nextbufctl-acceptance.XXXXXX")
trap 'rm -f "$DEFINITIONS"; rm -rf "$WORK"' EXIT HUP INT TERM

sed '/^command_name=/,$d' "$ROOT/nextbufctl" >"$DEFINITIONS"
# shellcheck disable=SC1090
. "$DEFINITIONS"

EVENTS="$WORK/events.log"
ENV_FILE="$WORK/.env"
COMPOSE_FILE="$WORK/compose.yml"
BACKUP_DIR="$WORK/backups"
mkdir -p "$BACKUP_DIR"
printf 'NEXTBUF_VERSION=0.13.10\n' >"$ENV_FILE"
: >"$COMPOSE_FILE"

compose_for_version() {
  version=$1
  shift
  printf 'compose_for_version:%s:%s\n' "$version" "$*" >>"$EVENTS"
  case "$*" in
    'run --rm --no-deps setup version') printf '%s\n' "$version" ;;
  esac
}

compose() {
  printf 'compose:%s\n' "$*" >>"$EVENTS"
  case "$*" in
    'run --rm -e NEXTBUF_MIGRATION_START_MARKER=/nextbuf-upgrade/migration-started -v '*':/nextbuf-upgrade setup')
      : >"$upgrade_migration_marker"
      ;;
  esac
}

do_backup() {
  printf 'backup\n' >>"$EVENTS"
  LAST_BACKUP="$BACKUP_DIR/nextbuf-0.13.10-test.tar.gz"
  : >"$LAST_BACKUP"
  resume_web=1
  resume_worker=1
}

capture_acceptance_snapshot() {
  version=$1
  output=$2
  printf 'capture:%s:%s\n' "$version" "$(basename "$output")" >>"$EVENTS"
  printf '{"snapshot":true}\n' >"$output"
}

compare_acceptance_snapshots() {
  version=$1
  before=$2
  after=$3
  output=$4
  [ -s "$before" ]
  [ -s "$after" ]
  printf 'compare:%s:%s:%s\n' "$version" "$(basename "$before")" "$(basename "$after")" \
    >>"$EVENTS"
  printf '{"status":"pass"}\n' >"$output"
}

wait_for_service() {
  printf 'wait:%s\n' "$1" >>"$EVENTS"
}

do_upgrade 1.0.0
trap 'rm -f "$DEFINITIONS"; rm -rf "$WORK"' EXIT HUP INT TERM

grep -q '^NEXTBUF_VERSION=1.0.0$' "$ENV_FILE"
before_line=$(grep -n 'capture:1.0.0:.*-before.json$' "$EVENTS" | cut -d: -f1)
setup_line=$(grep -n '^compose:run --rm -e NEXTBUF_MIGRATION_START_MARKER=/nextbuf-upgrade/migration-started -v .*:/nextbuf-upgrade setup$' "$EVENTS" | cut -d: -f1)
after_line=$(grep -n 'capture:1.0.0:.*-after.json$' "$EVENTS" | cut -d: -f1)
compare_line=$(grep -n '^compare:1.0.0:' "$EVENTS" | cut -d: -f1)
start_line=$(grep -n '^compose:up -d --no-deps web worker$' "$EVENTS" | cut -d: -f1)

[ "$before_line" -lt "$setup_line" ]
[ "$setup_line" -lt "$after_line" ]
[ "$after_line" -lt "$compare_line" ]
[ "$compare_line" -lt "$start_line" ]
grep -q '^wait:web$' "$EVENTS"
grep -q '^wait:worker$' "$EVENTS"

comparison=$(find "$BACKUP_DIR" -maxdepth 1 -name '*-comparison.json' -print -quit)
[ -n "$comparison" ]
[ -s "$comparison.SHA256" ]
[ "$(stat -c '%a' "$comparison.SHA256")" = 600 ]
grep -q "$(basename "$comparison")" "$comparison.SHA256"
if grep -q "$(dirname "$comparison")" "$comparison.SHA256"; then
  printf 'Evidence checksum unexpectedly leaked an absolute path.\n' >&2
  exit 1
fi

printf 'NEXTBUF_VERSION=0.13.10\n' >"$ENV_FILE"
: >"$EVENTS"
if (
  capture_acceptance_snapshot() { return 1; }
  do_upgrade 1.0.0
); then
  printf 'Upgrade unexpectedly continued after a pre-migration evidence failure.\n' >&2
  exit 1
fi
grep -q '^NEXTBUF_VERSION=0.13.10$' "$ENV_FILE"
grep -q '^compose:up -d --no-deps web worker$' "$EVENTS"

printf 'NEXTBUF_VERSION=0.13.10\n' >"$ENV_FILE"
: >"$EVENTS"
if (
  compose() {
    printf 'compose:%s\n' "$*" >>"$EVENTS"
    case "$*" in
      'run --rm -e NEXTBUF_MIGRATION_START_MARKER=/nextbuf-upgrade/migration-started -v '*':/nextbuf-upgrade setup')
        return 1
        ;;
    esac
  }
  do_upgrade 1.0.0
); then
  printf 'Upgrade unexpectedly continued when the setup container did not start.\n' >&2
  exit 1
fi
grep -q '^NEXTBUF_VERSION=0.13.10$' "$ENV_FILE"
grep -q '^compose:up -d --no-deps web worker$' "$EVENTS"

printf 'NEXTBUF_VERSION=0.13.10\n' >"$ENV_FILE"
: >"$EVENTS"
if (
  compose() {
    printf 'compose:%s\n' "$*" >>"$EVENTS"
    case "$*" in
      'run --rm -e NEXTBUF_MIGRATION_START_MARKER=/nextbuf-upgrade/migration-started -v '*':/nextbuf-upgrade setup')
        : >"$upgrade_migration_marker"
        return 1
        ;;
    esac
  }
  do_upgrade 1.0.0
); then
  printf 'Upgrade unexpectedly continued after target setup started and failed.\n' >&2
  exit 1
fi
grep -q '^NEXTBUF_VERSION=1.0.0$' "$ENV_FILE"
if grep -q '^compose:up -d --no-deps web worker$' "$EVENTS"; then
  printf 'Services unexpectedly resumed after target setup started.\n' >&2
  exit 1
fi

printf 'nextbufctl acceptance ordering passed.\n'
