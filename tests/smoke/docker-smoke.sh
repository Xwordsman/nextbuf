#!/bin/sh
set -eu
umask 077

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

ARCH=${1:-amd64}
RUN_RESTORE=${RUN_RESTORE:-0}
RUN_FAULTS=${RUN_FAULTS:-0}
SMOKE_TIMEOUT_SECONDS=${SMOKE_TIMEOUT_SECONDS:-1200}
SMOKE_VERSION=${NEXTBUF_SMOKE_VERSION:-1.0.0}
SMOKE_COMMIT=${NEXTBUF_SMOKE_COMMIT:-}
SMOKE_BUILD_TIME=${NEXTBUF_SMOKE_BUILD_TIME:-}
ENV_FILE=.env.smoke
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/nextbuf-docker-smoke.XXXXXX")
PANEL_COMPOSE=
SMOKE_BACKUP_DIR="$TMP_ROOT/backups"
COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml -f deploy/compose/compose.smoke.yml"
BASE_COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml"
STORAGE_BLOCKER=/app/data/uploads/.nextbuf-storage-blocker
MAILPIT_API_URL=http://127.0.0.1:38025
SMOKE_STAGE=bootstrap
watchdog_pid=

stage() {
  SMOKE_STAGE=$1
  printf '==> %s\n' "$SMOKE_STAGE"
}

wait_for_url() {
  url=$1
  timeout=${2:-180}
  deadline=$(( $(date +%s) + timeout ))
  until curl --fail --silent --max-time 5 "$url" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 2
  done
}

expect_url_failure() {
  url=$1
  timeout=${2:-30}
  deadline=$(( $(date +%s) + timeout ))
  while curl --fail --silent --max-time 5 "$url" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 1
  done
}

wait_for_container_health() {
  service=$1
  timeout=${2:-120}
  deadline=$(( $(date +%s) + timeout ))
  while :; do
    id=$(NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE ps -q "$service")
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)
    [ "$status" = healthy ] && return 0
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 2
  done
}

wait_for_named_container_health() {
  container=$1
  timeout=${2:-120}
  deadline=$(( $(date +%s) + timeout ))
  while :; do
    status=$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$container" 2>/dev/null || true)
    [ "$status" = healthy ] && return 0
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 2
  done
}

expect_doctor_failure() {
  check=$1
  report="$TMP_ROOT/doctor-$check.log"
  passed=0
  if [ "$check" = storage ]; then
    if NEXTBUF_ENV_FILE="$ENV_FILE" timeout --signal=TERM --kill-after=5s 60s \
      $BASE_COMPOSE --profile tools run --rm --no-deps \
      -e STORAGE_LOCAL_PATH="$STORAGE_BLOCKER" doctor >"$report" 2>&1; then
      passed=1
    fi
  elif NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
    timeout --signal=TERM --kill-after=5s 60s ./nextbufctl doctor >"$report" 2>&1; then
    passed=1
  fi
  if [ "$passed" = 1 ]; then
    printf 'Doctor unexpectedly passed while %s was unavailable\n' "$check" >&2
    cat "$report" >&2
    rm -f "$report"
    return 1
  fi
  if ! awk -v marker="\"$check\":" '
    index($0, marker) { active = 1; next }
    active && /"ok": false/ { found = 1; exit }
    active && /^    "[a-z]/ { exit }
    END { exit found ? 0 : 1 }
  ' "$report"; then
    printf 'Doctor did not attribute the failure to %s\n' "$check" >&2
    cat "$report" >&2
    rm -f "$report"
    return 1
  fi
  rm -f "$report"
}

expect_doctor_continuity_warning() {
  report="$TMP_ROOT/doctor-continuity.log"
  if ! NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
    timeout --signal=TERM --kill-after=5s 60s ./nextbufctl doctor >"$report" 2>&1; then
    cat "$report" >&2
    rm -f "$report"
    return 1
  fi
  if ! sh tests/smoke/assert-doctor-continuity-warning.sh "$report"; then
    printf 'Doctor did not report the expected single-administrator continuity warning\n' >&2
    cat "$report" >&2
    rm -f "$report"
    return 1
  fi
  cat "$report"
  rm -f "$report"
}

diagnose_failure() {
  diagnostics=$(
    printf 'Smoke stage: %s\n' "$SMOKE_STAGE"
    printf '%s\n' 'Compose status:'
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE ps -a 2>&1 || true
    printf '%s\n' 'Container logs:'
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE logs --no-color --tail=80 \
      postgres redis mailpit setup web worker 2>&1 || true
  )
  printf '%s\n' "$diagnostics" >&2

  if [ -n "${PANEL_COMPOSE:-}" ] && [ -f "$PANEL_COMPOSE" ]; then
    docker compose -f "$PANEL_COMPOSE" ps -a >&2 2>&1 || true
    docker compose -f "$PANEL_COMPOSE" logs --no-color --tail=80 >&2 2>&1 || true
  fi

  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    annotation=$(printf '%s' "$diagnostics" | tr '\n' ' ' | cut -c1-12000 | sed 's/%/%25/g')
    printf '::error title=NextBuf container smoke diagnostics::%s\n' "$annotation"
  fi
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "${watchdog_pid:-}" ]; then
    kill "$watchdog_pid" >/dev/null 2>&1 || true
    wait "$watchdog_pid" 2>/dev/null || true
  fi
  if [ "$status" -ne 0 ]; then
    diagnose_failure
  fi
  if [ -n "${PANEL_COMPOSE:-}" ] && [ -f "$PANEL_COMPOSE" ]; then
    docker compose -f "$PANEL_COMPOSE" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  rm -rf -- "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' HUP INT TERM

smoke_pid=$$
(
  sleep "$SMOKE_TIMEOUT_SECONDS"
  printf 'Smoke test timed out after %s seconds\n' "$SMOKE_TIMEOUT_SECONDS" >&2
  kill -TERM "$smoke_pid"
) &
watchdog_pid=$!

cp .env.example "$ENV_FILE"
sed -i \
  -e 's|^NEXTBUF_IMAGE=.*|NEXTBUF_IMAGE=nextbuf-smoke|' \
  -e "s|^NEXTBUF_VERSION=.*|NEXTBUF_VERSION=$SMOKE_VERSION|" \
  -e 's|^WEB_PORT=.*|WEB_PORT=3100|' \
  -e 's|^APP_URL=.*|APP_URL=http://127.0.0.1:3100|' \
  -e 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=nextbuf-smoke-postgres|' \
  -e 's|^REDIS_PASSWORD=.*|REDIS_PASSWORD=nextbuf-smoke-redis|' \
  -e 's|^AUTH_SECRET=.*|AUTH_SECRET=nextbuf-smoke-auth-secret-at-least-32-characters|' \
  -e 's|^SETUP_TOKEN=.*|SETUP_TOKEN=nextbuf-smoke-setup-token-at-least-32-characters|' \
  -e 's|^MAIL_PAYLOAD_KEY=.*|MAIL_PAYLOAD_KEY=SoxCSq6+35KG9qqH7JHtneowihiWs8hjtqqI37UhPQw=|' \
  -e 's|^SMTP_HOST=.*|SMTP_HOST=mailpit|' \
  -e 's|^SMTP_FROM=.*|SMTP_FROM=NextBuf Smoke <noreply@nextbuf.test>|' \
  -e 's|^AUTH_REGISTRATION_MODE=.*|AUTH_REGISTRATION_MODE=invite|' \
  "$ENV_FILE"

mkdir -p "$SMOKE_BACKUP_DIR"
stage 'validate Compose and start dependencies'
panel_services=$(docker compose -f compose.baota.yml config --services | sort)
[ "$panel_services" = "nextbuf
postgres
redis
worker" ] || {
  printf 'BaoTa Compose must contain exactly nextbuf, postgres, redis and worker\n' >&2
  printf '%s\n' "$panel_services" >&2
  exit 1
}
panel_config=$(docker compose -f compose.baota.yml config)
printf '%s\n' "$panel_config" | grep -q 'image: ghcr.io/xwordsman/nextbuf:latest'
panel_container_names=$(printf '%s\n' "$panel_config" | awk '$1 == "container_name:" { print $2 }' | sort)
[ "$panel_container_names" = "nextbuf
nextbuf-postgres
nextbuf-redis
nextbuf-worker" ] || {
  printf 'BaoTa Compose must use the four fixed NextBuf container names\n' >&2
  printf '%s\n' "$panel_container_names" >&2
  exit 1
}
if printf '%s\n' "$panel_config" | grep -q 'env_file:'; then
  printf 'BaoTa Compose must not require an env file\n' >&2
  exit 1
fi
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE config --quiet
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres redis mailpit

stage 'verify failed bootstrap cannot start Web'
bootstrap_report="$TMP_ROOT/bootstrap-failure.log"
if NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE run --rm --no-deps \
  -e AUTH_SECRET=too-short web >"$bootstrap_report" 2>&1; then
  echo 'Web bootstrap unexpectedly accepted an invalid production secret' >&2
  cat "$bootstrap_report" >&2
  exit 1
fi
grep -Eq 'AUTH_SECRET|at least|too small' "$bootstrap_report"
rm -f "$bootstrap_report"
if curl --fail --silent http://127.0.0.1:3100/health/ready >/dev/null 2>&1; then
  echo 'Web became ready after a failed bootstrap' >&2
  exit 1
fi

stage 'bootstrap an empty database through the default Compose startup'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d

deadline=$(( $(date +%s) + 180 ))
until curl --fail --silent http://127.0.0.1:3100/health/ready >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$deadline" ] || {
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE ps
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE logs web worker
    exit 1
  }
  sleep 2
done

version_report="$TMP_ROOT/version.json"
curl --fail --silent http://127.0.0.1:3100/api/version >"$version_report"
node - "$version_report" "$SMOKE_VERSION" "$SMOKE_COMMIT" "$SMOKE_BUILD_TIME" <<'NODE'
const fs = require("node:fs");
const [file, version, commit, buildTime] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, "utf8"));
if (report.version !== version) throw new Error(`Expected version ${version}, received ${report.version}`);
if (commit && report.commit !== commit) throw new Error(`Expected commit ${commit}, received ${report.commit}`);
if (buildTime && report.buildTime !== buildTime) {
  throw new Error(`Expected build time ${buildTime}, received ${report.buildTime}`);
}
NODE
rm -f "$version_report"

stage 'verify first visit redirect and generic empty node catalog'
home_headers="$TMP_ROOT/home-before-setup.headers"
home_status=$(curl --silent --dump-header "$home_headers" --output /dev/null \
  --write-out '%{http_code}' http://127.0.0.1:3100/)
[ "$home_status" = 307 ] || {
  printf 'Expected first visit status 307, received %s\n' "$home_status" >&2
  cat "$home_headers" >&2
  exit 1
}
if ! tr -d '\r' <"$home_headers" | grep -Eiq '^location: (https?://[^/]+)?/setup$'; then
  printf 'First visit did not redirect to /setup\n' >&2
  cat "$home_headers" >&2
  exit 1
fi
rm -f "$home_headers"
node_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_nodes"' | tr -d '\r')
[ "$node_count" = 0 ] || {
  printf 'Expected an empty node catalog, found %s nodes\n' "$node_count" >&2
  exit 1
}

stage 'reject an incomplete initial administrator without a credential'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'"'"'SQL'"'"'
INSERT INTO users (id, username, name, email, email_verified, status, created_at, updated_at)
VALUES ('"'"'10000000-0000-4000-8000-000000000001'"'"', '"'"'incomplete_admin'"'"', '"'"'Incomplete Admin'"'"', '"'"'incomplete-admin@nextbuf.test'"'"', FALSE, '"'"'pending'"'"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
SQL'
incomplete_report="$TMP_ROOT/setup-incomplete.json"
incomplete_status=$(curl --silent -o "$incomplete_report" -w '%{http_code}' \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Incomplete Admin","username":"incomplete_admin","email":"incomplete-admin@nextbuf.test","password":"incomplete-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
[ "$incomplete_status" = 409 ]
grep -q '"code":"initial_administrator_not_eligible"' "$incomplete_report"
incomplete_state=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM system_state WHERE key = '\''installation.completed'\''"' | tr -d '\r')
[ "$incomplete_state" = 0 ]
incomplete_roles=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_role_assignments WHERE role = '\''admin'\'' AND scope_key = '\''site'\''"' | tr -d '\r')
[ "$incomplete_roles" = 0 ]
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'"'"'SQL'"'"'
DELETE FROM users WHERE email = '"'"'incomplete-admin@nextbuf.test'"'"';
SELECT setval(pg_get_serial_sequence('"'"'users'"'"', '"'"'uid'"'"'), 1, FALSE);
SQL'

stage 'fence a fresh legacy installation claim and reclaim it after expiry'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'"'"'SQL'"'"'
INSERT INTO system_state (key, value, created_at, updated_at)
VALUES (
  '"'"'installation.claim'"'"',
  jsonb_build_object(
    '"'"'email'"'"', '"'"'smoke-admin@nextbuf.test'"'"',
    '"'"'username'"'"', '"'"'smoke_admin'"'"',
    '"'"'claimedAt'"'"', clock_timestamp()::text
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
SQL'
legacy_claim_report="$TMP_ROOT/setup-legacy-claim.json"
legacy_claim_status=$(curl --silent -o "$legacy_claim_report" -w '%{http_code}' \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Smoke Admin","username":"smoke_admin","email":"smoke-admin@nextbuf.test","password":"smoke-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
[ "$legacy_claim_status" = 409 ]
grep -q '"code":"setup_in_progress"' "$legacy_claim_report"
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "UPDATE system_state
       SET value = jsonb_set(value, '"'"'{claimedAt}'"'"', to_jsonb('"'"'2000-01-01T00:00:00.000Z'"'"'::text)),
           updated_at = CURRENT_TIMESTAMP
     WHERE key = '"'"'installation.claim'"'"'"'

legacy_other_report="$TMP_ROOT/setup-legacy-other.json"
legacy_other_status=$(curl --silent -o "$legacy_other_report" -w '%{http_code}' \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Other Admin","username":"other_admin","email":"other-admin@nextbuf.test","password":"other-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
[ "$legacy_other_status" = 409 ]
grep -q '"code":"existing_users_require_recovery"' "$legacy_other_report"
legacy_claim_owner=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT (value->>'\''email'\'') || '\''|'\'' || (value->>'\''username'\'') FROM system_state WHERE key = '\''installation.claim'\''"' | tr -d '\r')
[ "$legacy_claim_owner" = 'smoke-admin@nextbuf.test|smoke_admin' ]

stage 'create and reject repeated initial administrator setup'
response=$(curl --fail-with-body --silent \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Smoke Admin","username":"smoke_admin","email":"smoke-admin@nextbuf.test","password":"smoke-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
printf '%s' "$response" | grep -q '"ok":true'
first_admin_uid=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT uid FROM users WHERE email = '\''smoke-admin@nextbuf.test'\''"' | tr -d '\r')
[ "$first_admin_uid" = 1 ]

repeat_report="$TMP_ROOT/setup-repeat.json"
repeat_status=$(curl --silent -o "$repeat_report" -w '%{http_code}' \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Other Admin","username":"other_admin","email":"other-admin@nextbuf.test","password":"other-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
[ "$repeat_status" = 409 ]
curl --fail --silent http://127.0.0.1:3100/ >/dev/null

stage 'verify first administrator email through Mailpit'
expect_doctor_failure administratorContinuity
sh tests/smoke/verify-mailpit-user.sh \
  "$MAILPIT_API_URL" smoke-admin@nextbuf.test http://127.0.0.1:3100

stage 'wait for Worker health'
deadline=$(( $(date +%s) + 180 ))
until curl --fail --silent http://127.0.0.1:3100/health/worker >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$deadline" ] || exit 1
  sleep 2
done

stage 'verify the production topology has no stopped setup container'
running_services=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps \
  --status running --services postgres redis web worker | sort)
expected_services=$(printf '%s\n' postgres redis web worker | sort)
if [ "$running_services" != "$expected_services" ]; then
  printf 'Unexpected production services:\n%s\n' "$running_services" >&2
  exit 1
fi
setup_container=$(docker ps -a \
  --filter label=com.docker.compose.project=nextbuf \
  --filter label=com.docker.compose.service=setup \
  --quiet)
if [ -n "$setup_container" ]; then
  echo 'Default Compose left a setup container record behind' >&2
  exit 1
fi

stage 'run doctor and prepare backup fixture'
expect_doctor_continuity_warning

if [ "$RUN_FAULTS" = 1 ]; then
  stage 'inject and recover a PostgreSQL outage'
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE stop postgres
  expect_url_failure http://127.0.0.1:3100/health/ready
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres
  wait_for_container_health postgres 180
  wait_for_url http://127.0.0.1:3100/health/ready 180

  stage 'inject and recover a Redis outage'
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE stop redis
  expect_url_failure http://127.0.0.1:3100/health/ready
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d redis
  wait_for_container_health redis 120
  wait_for_url http://127.0.0.1:3100/health/ready 180
  wait_for_url http://127.0.0.1:3100/health/worker 180

  stage 'inject and recover a Worker outage'
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE stop worker
  expect_url_failure http://127.0.0.1:3100/health/worker 60
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps worker
  wait_for_url http://127.0.0.1:3100/health/worker 180

  stage 'inject and diagnose an SMTP outage'
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE stop mailpit
  expect_doctor_failure mail
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d mailpit
  wait_for_container_health mailpit 120

  stage 'inject and diagnose an invalid local storage root'
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup \
    -ec ': > /app/data/uploads/.nextbuf-storage-blocker'
  expect_doctor_failure storage
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup \
    -ec 'rm -f /app/data/uploads/.nextbuf-storage-blocker'

  stage 'verify all dependencies after fault recovery'
  expect_doctor_continuity_warning
fi

printf 'attachment-smoke-%s\n' "$ARCH" | NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat > /app/data/uploads/restore-proof.txt'

if [ "$RUN_RESTORE" = 1 ]; then
  stage 'create and restore an empty-install backup'
  NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
    NEXTBUF_BACKUP_DIR="$SMOKE_BACKUP_DIR" ./nextbufctl backup
  backup=$(find "$SMOKE_BACKUP_DIR" -maxdepth 1 -name 'nextbuf-*.tar.gz' -print | sort | tail -n 1)
  [ -n "$backup" ]
  backup_listing="$TMP_ROOT/backup.list"
  tar -tzf "$backup" >"$backup_listing"
  grep -Fxq './database.list' "$backup_listing"
  grep -Fxq './uploads.list' "$backup_listing"
  grep -Fxq './uploads.SHA256SUMS' "$backup_listing"
  mismatched_env="$TMP_ROOT/restore-mismatched-history.env"
  mismatch_log="$TMP_ROOT/restore-mismatched-history.log"
  cp "$ENV_FILE" "$mismatched_env"
  chmod 600 "$mismatched_env"
  sed -i 's#^TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=.*#TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=["nextbuf-mismatched-previous-auth-secret-at-least-32-characters"]#' "$mismatched_env"
  if NEXTBUFCTL_ASSUME_YES=1 NEXTBUF_ENV_FILE="$mismatched_env" NEXTBUF_COMPOSE_FILE=compose.yml NEXTBUF_BACKUP_DIR="$SMOKE_BACKUP_DIR" \
    ./nextbufctl restore "$backup" --yes >"$mismatch_log" 2>&1; then
    printf 'Restore accepted a mismatched historical topic-view secret list.\n' >&2
    exit 1
  fi
  grep -F 'TOPIC_VIEW_PREVIOUS_AUTH_SECRETS differs from the backup' "$mismatch_log" >/dev/null
  semantically_quoted_env="$TMP_ROOT/restore-semantically-quoted.env"
  semantic_compare_log="$TMP_ROOT/restore-semantic-compare.log"
  sed 's/^AUTH_SECRET=\(.*\)$/AUTH_SECRET="\1"/' "$ENV_FILE" >"$semantically_quoted_env"
  chmod 600 "$semantically_quoted_env"
  if printf 'NO\n' | NEXTBUF_ENV_FILE="$semantically_quoted_env" NEXTBUF_COMPOSE_FILE=compose.yml NEXTBUF_BACKUP_DIR="$SMOKE_BACKUP_DIR" \
    ./nextbufctl restore "$backup" >"$semantic_compare_log" 2>&1; then
    printf 'Restore unexpectedly continued after a negative confirmation.\n' >&2
    exit 1
  fi
  grep -F 'operation cancelled' "$semantic_compare_log" >/dev/null
  if grep -F 'AUTH_SECRET differs from the backup' "$semantic_compare_log" >/dev/null; then
    printf 'Restore compared dotenv source text instead of the parsed AUTH_SECRET.\n' >&2
    exit 1
  fi
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE rm -sf mailpit
  NEXTBUFCTL_ASSUME_YES=1 NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml NEXTBUF_BACKUP_DIR="$SMOKE_BACKUP_DIR" \
    ./nextbufctl restore "$backup" --empty-install --restore-config --keep-stopped --yes
  if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps --status running --services web worker | grep -q .; then
    printf 'Restore --keep-stopped unexpectedly started Web or Worker.\n' >&2
    exit 1
  fi
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d mailpit
  wait_for_container_health mailpit 120
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE up -d --no-deps web worker
  wait_for_url http://127.0.0.1:3100/health/ready 180
  wait_for_url http://127.0.0.1:3100/health/worker 180
  stage 'verify restored database and attachments'
  restore_proof="$TMP_ROOT/restore-proof.txt"
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup \
    -ec 'cat /app/data/uploads/restore-proof.txt' >"$restore_proof"
  grep -Fxq "attachment-smoke-$ARCH" "$restore_proof"
  restored_setup="$TMP_ROOT/restored-setup.json"
  curl --fail --silent http://127.0.0.1:3100/api/setup >"$restored_setup"
  grep -q '"complete":true' "$restored_setup"

  stage 'export a BaoTa deployment and restore it into controlled Compose'
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE down -v --remove-orphans
  PANEL_COMPOSE="$TMP_ROOT/compose.baota.smoke.yml"
  cp compose.baota.yml "$PANEL_COMPOSE"
  panel_postgres_password=$(printf '%064d' 0 | tr 0 d)
  panel_redis_password=$(printf '%064d' 0 | tr 0 e)
  panel_auth_secret=$(printf '%064d' 0 | tr 0 a)
  panel_setup_token=$(printf '%064d' 0 | tr 0 c)
  sed -i \
    -e "s|image: ghcr.io/xwordsman/nextbuf:latest|image: nextbuf-smoke:$SMOKE_VERSION|" \
    -e 's|APP_URL: https://community.example.com|APP_URL: http://127.0.0.1:3100|' \
    -e "s|AUTH_SECRET: replace-with-at-least-32-random-characters|AUTH_SECRET: $panel_auth_secret|" \
    -e "s|SETUP_TOKEN: replace-with-at-least-32-random-characters|SETUP_TOKEN: $panel_setup_token|" \
    -e 's|MAIL_PAYLOAD_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=|MAIL_PAYLOAD_KEY: SoxCSq6+35KG9qqH7JHtneowihiWs8hjtqqI37UhPQw=|' \
    -e 's|SMTP_HOST: smtp.example.com|SMTP_HOST: 127.0.0.1|' \
    -e 's|SMTP_PORT: "465"|SMTP_PORT: "1025"|' \
    -e 's|SMTP_SECURE: "true"|SMTP_SECURE: "false"|' \
    -e 's|SMTP_USER: replace-with-smtp-user|SMTP_USER: ""|' \
    -e 's|SMTP_PASSWORD: replace-with-smtp-password|SMTP_PASSWORD: ""|' \
    -e 's|SMTP_FROM: NextBuf <noreply@example.com>|SMTP_FROM: NextBuf Panel <noreply@nextbuf.test>|' \
    -e "s|DATABASE_URL: postgresql://nextbuf:replace-with-64-hex-postgres-password@postgres:5432/nextbuf|DATABASE_URL: postgresql://nextbuf:$panel_postgres_password@postgres:5432/nextbuf|" \
    -e "s|DATABASE_DIRECT_URL: postgresql://nextbuf:replace-with-64-hex-postgres-password@postgres:5432/nextbuf|DATABASE_DIRECT_URL: postgresql://nextbuf:$panel_postgres_password@postgres:5432/nextbuf|" \
    -e "s|REDIS_URL: redis://:replace-with-64-hex-redis-password@redis:6379/0|REDIS_URL: redis://:$panel_redis_password@redis:6379/0|" \
    -e "s|POSTGRES_PASSWORD: replace-with-64-hex-postgres-password|POSTGRES_PASSWORD: $panel_postgres_password|" \
    -e "s|REDIS_PASSWORD: replace-with-64-hex-redis-password|REDIS_PASSWORD: $panel_redis_password|" \
    -e 's|127.0.0.1:3000:3000|127.0.0.1:3100:3000|' \
    "$PANEL_COMPOSE"
  panel_auth_expected="$TMP_ROOT/panel-auth-secret.base64"
  panel_previous_auth_expected="$TMP_ROOT/panel-previous-auth-secrets.base64"
  node - "$PANEL_COMPOSE" "$panel_auth_expected" "$panel_previous_auth_expected" <<'NODE'
const fs = require("node:fs");

const [, , composePath, authOutput, previousOutput] = process.argv;
const authSecret = ` "auth $NAME \${NAME} $$ # \\'"\tsecret ${"z".repeat(32)}" `;
const previousAuthSecrets = JSON.stringify([
  ` "old $OLD \${OLD} $$ # \\'"\tsecret ${"y".repeat(32)}" `,
  `second-old-secret-${"x".repeat(32)}`,
]);
const yamlValue = (value) => JSON.stringify(value.replaceAll("$", "$$"));
let compose = fs.readFileSync(composePath, "utf8");
compose = compose.replace(/^    AUTH_SECRET:.*$/m, `    AUTH_SECRET: ${yamlValue(authSecret)}`);
compose = compose.replace(
  /^    TOPIC_VIEW_PREVIOUS_AUTH_SECRETS:.*$/m,
  `    TOPIC_VIEW_PREVIOUS_AUTH_SECRETS: ${yamlValue(previousAuthSecrets)}`,
);
fs.writeFileSync(composePath, compose);
fs.writeFileSync(authOutput, Buffer.from(authSecret).toString("base64"));
fs.writeFileSync(previousOutput, Buffer.from(previousAuthSecrets).toString("base64"));
NODE
  docker compose -f "$PANEL_COMPOSE" config --quiet
  docker compose -f "$PANEL_COMPOSE" up -d
  wait_for_named_container_health nextbuf-postgres 180
  wait_for_named_container_health nextbuf-redis 120
  wait_for_named_container_health nextbuf 180
  wait_for_named_container_health nextbuf-worker 180
  for panel_container in nextbuf nextbuf-worker; do
    docker exec "$panel_container" node -e \
      'process.stdout.write(Buffer.from(process.env.AUTH_SECRET).toString("base64"))' \
      >"$TMP_ROOT/$panel_container-auth-secret.base64"
    cmp "$panel_auth_expected" "$TMP_ROOT/$panel_container-auth-secret.base64"
    docker exec "$panel_container" node -e \
      'process.stdout.write(Buffer.from(process.env.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS).toString("base64"))' \
      >"$TMP_ROOT/$panel_container-previous-auth-secrets.base64"
    cmp "$panel_previous_auth_expected" \
      "$TMP_ROOT/$panel_container-previous-auth-secrets.base64"
  done
  printf 'baota-transfer-%s\n' "$ARCH" | docker exec -i nextbuf sh -ec \
    'cat > /app/data/uploads/baota-transfer-proof.txt'
  panel_database_marker="baota-database-transfer-$ARCH"
  printf "INSERT INTO system_state (key, value, created_at, updated_at) VALUES ('smoke.baota-transfer', jsonb_build_object('marker', '%s'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;\n" \
    "$panel_database_marker" | docker exec -i nextbuf-postgres sh -ec \
    'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

  stage 'restore BaoTa writers when interrupted during docker stop'
  panel_signal_bin="$TMP_ROOT/baota-signal-bin"
  mkdir -p "$panel_signal_bin"
  real_docker=$(command -v docker)
  cat >"$panel_signal_bin/docker" <<EOF
#!/bin/sh
if [ "\${1:-}" = stop ] && [ "\${2:-}" = --time ] && [ "\${3:-}" = 45 ] && [ "\${4:-}" = nextbuf-worker ] && [ ! -f "$TMP_ROOT/baota-stop-signal.triggered" ]; then
  touch "$TMP_ROOT/baota-stop-signal.triggered"
  ("$real_docker" "\$@" >/dev/null 2>&1 || true) &
  kill -TERM "\$PPID"
  exit 0
fi
exec "$real_docker" "\$@"
EOF
  chmod +x "$panel_signal_bin/docker"
  panel_signal_backup_dir="$TMP_ROOT/baota-signal-backups"
  mkdir -p "$panel_signal_backup_dir"
  if PATH="$panel_signal_bin:$PATH" NEXTBUF_BACKUP_DIR="$panel_signal_backup_dir" \
    ./nextbufctl backup --baota "$PANEL_COMPOSE" >"$TMP_ROOT/baota-signal-backup.log" 2>&1; then
    printf 'BaoTa export unexpectedly survived the injected stop signal.\n' >&2
    exit 1
  fi
  [ -f "$TMP_ROOT/baota-stop-signal.triggered" ]
  wait_for_named_container_health nextbuf 180
  wait_for_named_container_health nextbuf-worker 180
  if find "$panel_signal_backup_dir" -mindepth 1 -print -quit | grep -q .; then
    printf 'Interrupted BaoTa export left a temporary or final archive.\n' >&2
    find "$panel_signal_backup_dir" -mindepth 1 -maxdepth 2 -print >&2
    exit 1
  fi

  stage 'recover BaoTa services when an export fails after stopping writers'
  panel_failure_bin="$TMP_ROOT/baota-failure-bin"
  panel_failed_backup_dir="$TMP_ROOT/baota-failed-backups"
  mkdir -p "$panel_failure_bin" "$panel_failed_backup_dir"
  real_sha256sum=$(command -v sha256sum)
  cat >"$panel_failure_bin/sha256sum" <<EOF
#!/bin/sh
case "\${1:-}" in
  *.tar.gz.partial)
    touch "$TMP_ROOT/baota-checksum-failure.triggered"
    exit 73
    ;;
esac
exec "$real_sha256sum" "\$@"
EOF
  chmod +x "$panel_failure_bin/sha256sum"
  if PATH="$panel_failure_bin:$PATH" NEXTBUF_BACKUP_DIR="$panel_failed_backup_dir" \
    ./nextbufctl backup --baota "$PANEL_COMPOSE" >"$TMP_ROOT/baota-failed-backup.log" 2>&1; then
    printf 'BaoTa export unexpectedly succeeded with injected checksum failure.\n' >&2
    exit 1
  fi
  [ -f "$TMP_ROOT/baota-checksum-failure.triggered" ]
  wait_for_named_container_health nextbuf 180
  wait_for_named_container_health nextbuf-worker 180
  if find "$panel_failed_backup_dir" -mindepth 1 -print -quit | grep -q .; then
    printf 'Failed BaoTa export left a temporary or final archive.\n' >&2
    find "$panel_failed_backup_dir" -mindepth 1 -maxdepth 2 -print >&2
    exit 1
  fi

  panel_backup_dir="$TMP_ROOT/baota-backups"
  mkdir -p "$panel_backup_dir"
  NEXTBUF_BACKUP_DIR="$panel_backup_dir" ./nextbufctl backup --baota "$PANEL_COMPOSE"
  wait_for_named_container_health nextbuf 180
  wait_for_named_container_health nextbuf-worker 180
  panel_backup=$(find "$panel_backup_dir" -maxdepth 1 -name 'nextbuf-*.tar.gz' -print | sort | tail -n 1)
  [ -n "$panel_backup" ]
  (cd "$panel_backup_dir" && sha256sum -c "$(basename "$panel_backup").sha256")
  panel_backup_listing="$TMP_ROOT/baota-backup.list"
  tar -tzf "$panel_backup" >"$panel_backup_listing"
  grep -Fxq './source-deployment.json' "$panel_backup_listing"
  grep -Fxq './source-compose.baota.yml' "$panel_backup_listing"
  grep -Fxq './uploads.SHA256SUMS' "$panel_backup_listing"
  tar -xOf "$panel_backup" ./manifest.json | grep -q '"sourceDeployment":"baota"'

  docker compose -f "$PANEL_COMPOSE" down -v --remove-orphans
  NEXTBUFCTL_ASSUME_YES=1 NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml NEXTBUF_BACKUP_DIR="$panel_backup_dir" \
    ./nextbufctl restore "$panel_backup" --empty-install --restore-config --keep-stopped --yes
  if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps --status running --services web worker | grep -q .; then
    printf 'BaoTa transfer restore unexpectedly started Web or Worker.\n' >&2
    exit 1
  fi
  panel_restore_proof="$TMP_ROOT/baota-transfer-proof.txt"
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup \
    -ec 'cat /app/data/uploads/baota-transfer-proof.txt' >"$panel_restore_proof"
  grep -Fxq "baota-transfer-$ARCH" "$panel_restore_proof"
  restored_panel_database_marker=$(printf "%s\n" \
    "SELECT value->>'marker' FROM system_state WHERE key = 'smoke.baota-transfer';" | \
    NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
      'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' | tr -d '\r')
  [ "$restored_panel_database_marker" = "$panel_database_marker" ]
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE up -d --no-deps web worker
  wait_for_url http://127.0.0.1:3100/health/ready 180
  wait_for_url http://127.0.0.1:3100/health/worker 180
  restored_web_container=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps -q web)
  restored_worker_container=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps -q worker)
  for restored_container in "$restored_web_container" "$restored_worker_container"; do
    docker exec "$restored_container" node -e \
      'process.stdout.write(Buffer.from(process.env.AUTH_SECRET).toString("base64"))' \
      >"$TMP_ROOT/$restored_container-auth-secret.base64"
    cmp "$panel_auth_expected" "$TMP_ROOT/$restored_container-auth-secret.base64"
    docker exec "$restored_container" node -e \
      'process.stdout.write(Buffer.from(process.env.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS).toString("base64"))' \
      >"$TMP_ROOT/$restored_container-previous-auth-secrets.base64"
    cmp "$panel_previous_auth_expected" \
      "$TMP_ROOT/$restored_container-previous-auth-secrets.base64"
  done
fi

stage 'report final service state'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps
