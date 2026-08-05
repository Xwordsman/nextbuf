#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DEFINITIONS=$(mktemp "${TMPDIR:-/tmp}/nextbufctl-restore-definitions.XXXXXX")
WORK=$(mktemp -d "${TMPDIR:-/tmp}/nextbufctl-restore-continuity.XXXXXX")
trap 'rm -f "$DEFINITIONS"; rm -rf "$WORK"' EXIT HUP INT TERM

sed '/^command_name=/,$d' "$ROOT/nextbufctl" >"$DEFINITIONS"
# shellcheck disable=SC1090
. "$DEFINITIONS"

temp="$WORK/rendered"
ENV_FILE="$WORK/current.env"
COMPOSE_FILE="$WORK/compose.yml"
BACKUP_ENVIRONMENT="$WORK/backup.env"
MISMATCHED_ENVIRONMENT="$WORK/mismatched.env"
EMPTY_REQUIRED_ENVIRONMENT="$WORK/empty-required.env"
OMITTED_REQUIRED_ENVIRONMENT="$WORK/omitted-required.env"
EMPTY_S3_ENVIRONMENT="$WORK/empty-s3.env"
mkdir -p "$temp"
: >"$COMPOSE_FILE"

write_environment() {
  destination=$1
  auth_secret=$2
  previous_secrets=$3
  cat >"$destination" <<EOF
NEXTBUF_IMAGE=ghcr.io/xwordsman/nextbuf
NEXTBUF_VERSION=1.0.0
AUTH_SECRET=$auth_secret
TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=$previous_secrets
MAIL_PAYLOAD_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
STORAGE_DRIVER=local
S3_BUCKET=
EOF
}

write_environment \
  "$ENV_FILE" \
  nextbuf-restore-current-auth-secret-at-least-32-characters \
  '["nextbuf-restore-old-auth-secret-at-least-32-characters"]'
write_environment \
  "$BACKUP_ENVIRONMENT" \
  '"nextbuf-restore-current-auth-secret-at-least-32-characters"' \
  '["nextbuf-restore-old-auth-secret-at-least-32-characters"]'
sed -i 's#^NEXTBUF_IMAGE=.*#NEXTBUF_IMAGE=invalid.example/backup-image-must-not-run#' "$BACKUP_ENVIRONMENT"
sed -i 's#^NEXTBUF_VERSION=.*#NEXTBUF_VERSION=0.13.10#' "$BACKUP_ENVIRONMENT"
write_environment \
  "$MISMATCHED_ENVIRONMENT" \
  nextbuf-restore-current-auth-secret-at-least-32-characters \
  '["nextbuf-restore-different-old-auth-secret-at-least-32-characters"]'
sed -i 's#^NEXTBUF_IMAGE=.*#NEXTBUF_IMAGE=invalid.example/backup-image-must-not-run#' "$MISMATCHED_ENVIRONMENT"
sed -i 's#^NEXTBUF_VERSION=.*#NEXTBUF_VERSION=0.13.10#' "$MISMATCHED_ENVIRONMENT"
cp "$BACKUP_ENVIRONMENT" "$EMPTY_REQUIRED_ENVIRONMENT"
sed -i 's#^MAIL_PAYLOAD_KEY=.*#MAIL_PAYLOAD_KEY=#' "$EMPTY_REQUIRED_ENVIRONMENT"
cp "$BACKUP_ENVIRONMENT" "$OMITTED_REQUIRED_ENVIRONMENT"
sed -i '/^AUTH_SECRET=/d' "$OMITTED_REQUIRED_ENVIRONMENT"
cp "$BACKUP_ENVIRONMENT" "$EMPTY_S3_ENVIRONMENT"
sed -i 's#^STORAGE_DRIVER=.*#STORAGE_DRIVER=s3#' "$EMPTY_S3_ENVIRONMENT"

docker() {
  [ "${1:-}" = compose ] || return 1
  shift
  environment_file=
  comparison_file=
  command=
  format=
  profile=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --profile)
        profile=$2
        shift 2
        ;;
      --env-file)
        environment_file=$2
        shift 2
        ;;
      -f)
        comparison_file=$2
        shift 2
        ;;
      --format)
        format=$2
        shift 2
        ;;
      config)
        command=config
        shift
        ;;
      *) shift ;;
    esac
  done
  [ "$command" = config ]
  [ "$format" = json ]
  [ "$profile" = tools ]
  [ -n "$environment_file" ]
  [ -n "$comparison_file" ]
  for field in \
    NEXTBUF_RESTORE_COMPARE_AUTH_SECRET \
    NEXTBUF_RESTORE_COMPARE_TOPIC_VIEW_PREVIOUS_AUTH_SECRETS \
    NEXTBUF_RESTORE_COMPARE_MAIL_PAYLOAD_KEY \
    NEXTBUF_RESTORE_COMPARE_STORAGE_DRIVER \
    NEXTBUF_RESTORE_COMPARE_S3_BUCKET; do
    grep -Fq "$field" "$comparison_file"
  done
  node - "$environment_file" "${MOCK_MISSING_FIELD:-}" <<'NODE'
const fs = require("node:fs");

const source = fs.readFileSync(process.argv[2], "utf8");
const missingField = process.argv[3];
const parsed = {};
for (const line of source.split(/\r?\n/u)) {
  if (line === "" || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator);
  const raw = line.slice(separator + 1);
  if (raw.startsWith('"') && raw.endsWith('"')) {
    parsed[key] = JSON.parse(raw);
  } else if (raw.startsWith("'") && raw.endsWith("'")) {
    parsed[key] = raw.slice(1, -1);
  } else {
    parsed[key] = raw;
  }
}

const environment = {
  NEXTBUF_RESTORE_COMPARE_AUTH_SECRET: parsed.AUTH_SECRET ?? "",
  NEXTBUF_RESTORE_COMPARE_TOPIC_VIEW_PREVIOUS_AUTH_SECRETS:
    parsed.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS || "[]",
  NEXTBUF_RESTORE_COMPARE_MAIL_PAYLOAD_KEY: parsed.MAIL_PAYLOAD_KEY ?? "",
  NEXTBUF_RESTORE_COMPARE_STORAGE_DRIVER: parsed.STORAGE_DRIVER ?? "",
  NEXTBUF_RESTORE_COMPARE_S3_BUCKET: parsed.S3_BUCKET ?? "",
};
delete environment[missingField];
process.stdout.write(JSON.stringify({ services: { setup: { environment } } }));
NODE
}

compose() {
  [ "$ENV_FILE" = "$WORK/current.env" ] || {
    printf 'Restore continuity attempted to execute the backup image configuration.\n' >&2
    return 1
  }
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -e ]; then
      shift
      node -e "$1"
      return
    fi
    shift
  done
  return 1
}

verify_restore_environment_continuity "$BACKUP_ENVIRONMENT"

MISMATCH_LOG="$WORK/mismatch.log"
if (verify_restore_environment_continuity "$MISMATCHED_ENVIRONMENT") >"$MISMATCH_LOG" 2>&1; then
  printf 'Restore continuity accepted a mismatched historical secret list.\n' >&2
  exit 1
fi
grep -F 'TOPIC_VIEW_PREVIOUS_AUTH_SECRETS differs from the backup' "$MISMATCH_LOG" >/dev/null

MISSING_LOG="$WORK/missing.log"
if (
  MOCK_MISSING_FIELD=NEXTBUF_RESTORE_COMPARE_MAIL_PAYLOAD_KEY
  verify_restore_environment_continuity "$BACKUP_ENVIRONMENT"
) >"$MISSING_LOG" 2>&1; then
  printf 'Restore continuity accepted an incomplete rendered configuration.\n' >&2
  exit 1
fi
grep -F 'MAIL_PAYLOAD_KEY could not be resolved from the current configuration' "$MISSING_LOG" >/dev/null

EMPTY_REQUIRED_LOG="$WORK/empty-required.log"
if (verify_restore_environment_continuity "$EMPTY_REQUIRED_ENVIRONMENT") >"$EMPTY_REQUIRED_LOG" 2>&1; then
  printf 'Restore continuity accepted an empty required comparison value.\n' >&2
  exit 1
fi
grep -F 'MAIL_PAYLOAD_KEY could not be resolved from the backup configuration' "$EMPTY_REQUIRED_LOG" >/dev/null

OMITTED_REQUIRED_LOG="$WORK/omitted-required.log"
if (verify_restore_environment_continuity "$OMITTED_REQUIRED_ENVIRONMENT") >"$OMITTED_REQUIRED_LOG" 2>&1; then
  printf 'Restore continuity accepted an omitted required comparison value.\n' >&2
  exit 1
fi
grep -F 'AUTH_SECRET could not be resolved from the backup configuration' "$OMITTED_REQUIRED_LOG" >/dev/null

EMPTY_S3_LOG="$WORK/empty-s3.log"
if (verify_restore_environment_continuity "$EMPTY_S3_ENVIRONMENT") >"$EMPTY_S3_LOG" 2>&1; then
  printf 'Restore continuity accepted an empty S3 bucket.\n' >&2
  exit 1
fi
grep -F 'S3_BUCKET could not be resolved from the backup configuration' "$EMPTY_S3_LOG" >/dev/null

printf 'nextbufctl restore continuity comparisons passed.\n'
