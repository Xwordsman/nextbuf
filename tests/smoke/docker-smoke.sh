#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

ARCH=${1:-amd64}
RUN_RESTORE=${RUN_RESTORE:-0}
RUN_FAULTS=${RUN_FAULTS:-0}
SMOKE_TIMEOUT_SECONDS=${SMOKE_TIMEOUT_SECONDS:-1200}
SMOKE_VERSION=${NEXTBUF_SMOKE_VERSION:-0.13.1}
ENV_FILE=.env.smoke
COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml -f deploy/compose/compose.smoke.yml"
BASE_COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml"
STORAGE_BLOCKER=/app/data/uploads/.nextbuf-storage-blocker
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

expect_doctor_failure() {
  check=$1
  report="/tmp/nextbuf-doctor-$check-$$.log"
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
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  rm -rf backups
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

mkdir -p backups
stage 'validate Compose and start dependencies'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE config --quiet
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres redis mailpit

stage 'verify failed bootstrap cannot start Web'
bootstrap_report=/tmp/nextbuf-bootstrap-failure.log
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

stage 'verify first visit redirect and generic empty node catalog'
home_headers=/tmp/nextbuf-home-before-setup.headers
home_status=$(curl --silent --dump-header "$home_headers" --output /dev/null \
  --write-out '%{http_code}' http://127.0.0.1:3100/)
[ "$home_status" = 307 ]
tr -d '\r' <"$home_headers" | grep -Eiq '^location: (https?://[^/]+)?/setup$'
rm -f "$home_headers"
node_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_nodes"' | tr -d '\r')
[ "$node_count" = 0 ]

stage 'create and reject repeated initial administrator setup'
response=$(curl --fail-with-body --silent \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Smoke Admin","username":"smoke_admin","email":"smoke-admin@nextbuf.test","password":"smoke-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
printf '%s' "$response" | grep -q '"ok":true'

repeat_status=$(curl --silent -o /tmp/nextbuf-setup-repeat.json -w '%{http_code}' \
  -H 'origin: http://127.0.0.1:3100' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Other Admin","username":"other_admin","email":"other-admin@nextbuf.test","password":"other-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
[ "$repeat_status" = 409 ]
curl --fail --silent http://127.0.0.1:3100/ >/dev/null

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
NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml ./nextbufctl doctor

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
  NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml ./nextbufctl doctor
fi

printf 'attachment-smoke-%s\n' "$ARCH" | NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat > /app/data/uploads/restore-proof.txt'

if [ "$RUN_RESTORE" = 1 ]; then
  stage 'create and restore an empty-install backup'
  NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml ./nextbufctl backup
  backup=$(find backups -maxdepth 1 -name 'nextbuf-*.tar.gz' -print | sort | tail -n 1)
  [ -n "$backup" ]
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE rm -sf mailpit
  NEXTBUFCTL_ASSUME_YES=1 NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
    ./nextbufctl restore "$backup" --empty-install --restore-config --yes
  stage 'verify restored database and attachments'
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat /app/data/uploads/restore-proof.txt' | grep -q "attachment-smoke-$ARCH"
  curl --fail --silent http://127.0.0.1:3100/api/setup | grep -q '"complete":true'
fi

stage 'report final service state'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps
