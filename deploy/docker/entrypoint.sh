#!/bin/sh
set -eu

command_name="${1:-web}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$command_name" in
  web)
    node dist/cli/index.mjs preflight web
    exec node scripts/start-standalone.mjs "$@"
    ;;
  worker)
    node dist/cli/index.mjs preflight worker
    exec node dist/worker/index.mjs "$@"
    ;;
  setup|migrate|doctor|preflight|version|invite|mail)
    exec node dist/cli/index.mjs "$command_name" "$@"
    ;;
  cli)
    exec node dist/cli/index.mjs "$@"
    ;;
  *)
    exec "$command_name" "$@"
    ;;
esac
