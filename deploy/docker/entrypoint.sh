#!/bin/sh
set -eu

command_name="${1:-web}"
if [ "$#" -gt 0 ]; then
  shift
fi

mark_migration_started() {
  marker=${NEXTBUF_MIGRATION_START_MARKER:-}
  case "$marker" in
    "") ;;
    /nextbuf-upgrade/migration-started) : >"$marker" ;;
    *)
      printf 'nextbuf: invalid migration start marker path\n' >&2
      exit 1
      ;;
  esac
}

case "$command_name" in
  web)
    node dist/cli/index.mjs preflight web
    exec node scripts/start-standalone.mjs "$@"
    ;;
  worker)
    node dist/cli/index.mjs preflight worker
    exec node dist/worker/index.mjs "$@"
    ;;
  setup|migrate)
    mark_migration_started
    exec node dist/cli/index.mjs "$command_name" "$@"
    ;;
  doctor|preflight|version|invite|mail|acceptance)
    exec node dist/cli/index.mjs "$command_name" "$@"
    ;;
  cli)
    exec node dist/cli/index.mjs "$@"
    ;;
  *)
    exec "$command_name" "$@"
    ;;
esac
