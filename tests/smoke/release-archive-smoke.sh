#!/bin/sh
set -eu

RELEASE_ROOT=${1:?Usage: release-archive-smoke.sh <extracted-release-root> <version>}
VERSION=${2:?Usage: release-archive-smoke.sh <extracted-release-root> <version>}
EXPECTED_COMMIT=${3:?Usage: release-archive-smoke.sh <extracted-release-root> <version> <commit> <build-time>}
EXPECTED_BUILD_TIME=${4:?Usage: release-archive-smoke.sh <extracted-release-root> <version> <commit> <build-time>}
unset NEXTBUF_VERSION NEXTBUF_COMMIT NEXTBUF_BUILD_TIME
RELEASE_ROOT=$(CDPATH= cd -- "$RELEASE_ROOT" && pwd)
RUNTIME_ROOT="$RELEASE_ROOT/runtime"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/nextbuf-archive-smoke.XXXXXX")
WEB_LOG="$TMP_ROOT/web.log"
WORKER_LOG="$TMP_ROOT/worker.log"
SETUP_LOG="$TMP_ROOT/setup.log"
DOCTOR_LOG="$TMP_ROOT/doctor.log"
WEB_PID=
WORKER_PID=

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e

  for pid in "$WORKER_PID" "$WEB_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill -TERM "$pid" >/dev/null 2>&1
    fi
  done
  for pid in "$WORKER_PID" "$WEB_PID"; do
    if [ -n "$pid" ]; then
      wait "$pid" >/dev/null 2>&1
    fi
  done

  rm -f "$RUNTIME_ROOT/.env"
  if [ "$status" -ne 0 ]; then
    for log in "$SETUP_LOG" "$WEB_LOG" "$WORKER_LOG" "$DOCTOR_LOG"; do
      if [ -s "$log" ]; then
        printf '\n--- %s ---\n' "$(basename "$log")" >&2
        cat "$log" >&2
      fi
    done
  fi
  rm -rf "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' HUP INT TERM

fail() {
  printf '%s\n' "$1" >&2
  return 1
}

wait_for_url() {
  url=$1
  timeout_seconds=${2:-180}
  deadline=$(( $(date +%s) + timeout_seconds ))
  until curl --fail --silent "$url" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      fail "Timed out waiting for $url"
    fi
    if [ -n "$WEB_PID" ] && ! kill -0 "$WEB_PID" >/dev/null 2>&1; then
      fail "Archive Web process exited before $url became ready"
    fi
    sleep 2
  done
}

test -f "$RELEASE_ROOT/checksums.txt"
test -x "$RUNTIME_ROOT/deploy/bin/nextbuf"
test -x "$RUNTIME_ROOT/deploy/bin/nextbuf-service"
test -r "$RUNTIME_ROOT/.nextbuf-build.env"
test -f "$RELEASE_ROOT/deploy/systemd/nextbuf-web.service"
test -f "$RELEASE_ROOT/deploy/systemd/nextbuf-worker.service"
test -f "$RELEASE_ROOT/deploy/pm2/ecosystem.config.cjs"

(cd "$RELEASE_ROOT" && sha256sum --check checksums.txt >/dev/null)

for service in nextbuf-web nextbuf-worker; do
  unit="$RELEASE_ROOT/deploy/systemd/$service.service"
  grep -Fqx 'WorkingDirectory=/opt/nextbuf/current/runtime' "$unit"
  grep -Fqx "ExecStart=/opt/nextbuf/current/runtime/deploy/bin/nextbuf-service ${service#nextbuf-}" "$unit"
done

node - "$RELEASE_ROOT/deploy/pm2/ecosystem.config.cjs" <<'NODE'
const config = require(process.argv[2]);
const expected = new Map([
  ["nextbuf-web", "web"],
  ["nextbuf-worker", "worker"],
]);

if (!Array.isArray(config.apps) || config.apps.length !== expected.size) {
  throw new Error("PM2 release contract must define exactly the Web and Worker apps");
}
for (const app of config.apps) {
  if (expected.get(app.name) !== app.args) {
    throw new Error(`Unexpected PM2 app contract for ${app.name ?? "unnamed app"}`);
  }
  if (app.cwd !== "/opt/nextbuf/current/runtime") {
    throw new Error(`${app.name} must run from the archive runtime directory`);
  }
  if (app.script !== "deploy/bin/nextbuf-service" || app.interpreter !== "none") {
    throw new Error(`${app.name} must execute the packaged service wrapper directly`);
  }
}
NODE

DATABASE_URL=${DATABASE_URL:-postgresql://nextbuf:nextbuf_archive@127.0.0.1:5432/nextbuf_archive}
REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379/0}
SMTP_HOST=${SMTP_HOST:-127.0.0.1}
SMTP_PORT=${SMTP_PORT:-1025}
SETUP_TOKEN=nextbuf-archive-setup-token-at-least-32-characters

mkdir -p "$RUNTIME_ROOT/data/uploads"
cat >"$RUNTIME_ROOT/.env" <<EOF
NODE_ENV=production
APP_URL=http://127.0.0.1:3000
HOSTNAME=0.0.0.0
PORT=3000
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL
REDIS_PREFIX=nextbuf_archive_smoke
AUTH_SECRET=nextbuf-archive-auth-secret-at-least-32-characters
SETUP_TOKEN=$SETUP_TOKEN
AUTH_REGISTRATION_MODE=invite
MAIL_PAYLOAD_KEY=SoxCSq6+35KG9qqH7JHtneowihiWs8hjtqqI37UhPQw=
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=false
SMTP_FROM=NextBuf Archive Smoke <noreply@nextbuf.test>
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=data/uploads
EOF
chmod 600 "$RUNTIME_ROOT/.env"
NEXTBUF_ENV_FILE="$RUNTIME_ROOT/.env"
export NEXTBUF_ENV_FILE

actual_version=$(cd "$RUNTIME_ROOT" && ./deploy/bin/nextbuf version)
[ "$actual_version" = "$VERSION" ] || fail "Archive version $actual_version does not match $VERSION"

(cd "$RUNTIME_ROOT" && ./deploy/bin/nextbuf setup) >"$SETUP_LOG" 2>&1

(
  cd "$RUNTIME_ROOT"
  exec ./deploy/bin/nextbuf-service web
) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

(
  cd "$RUNTIME_ROOT"
  exec ./deploy/bin/nextbuf-service worker
) >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!

wait_for_url http://127.0.0.1:3000/health/ready
tr '\0' '\n' <"/proc/$WEB_PID/environ" | grep -Fqx 'HOSTNAME=127.0.0.1'
curl --fail --silent http://127.0.0.1:3000/health/live | grep -Fq "\"version\":\"$VERSION\""
version_report="$TMP_ROOT/version.json"
curl --fail --silent http://127.0.0.1:3000/api/version >"$version_report"
node - "$version_report" "$VERSION" "$EXPECTED_COMMIT" "$EXPECTED_BUILD_TIME" <<'NODE'
const fs = require("node:fs");
const [file, version, commit, buildTime] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, "utf8"));
for (const [key, expected] of Object.entries({ version, commit, buildTime })) {
  if (report[key] !== expected) throw new Error(`Expected ${key}=${expected}, received ${report[key]}`);
}
NODE

setup_response=$(curl --fail-with-body --silent --show-error \
  -H 'origin: http://127.0.0.1:3000' \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$SETUP_TOKEN\",\"name\":\"Archive Admin\",\"username\":\"archive_admin\",\"email\":\"archive-admin@nextbuf.test\",\"password\":\"archive-admin-password-12345\"}" \
  http://127.0.0.1:3000/api/setup)
printf '%s' "$setup_response" | grep -Fq '"ok":true'

wait_for_url http://127.0.0.1:3000/health/worker
(cd "$RUNTIME_ROOT" && ./deploy/bin/nextbuf doctor) >"$DOCTOR_LOG" 2>&1
grep -Fq '"status": "ok"' "$DOCTOR_LOG"

printf 'Release archive %s started Web and Worker successfully.\n' "$VERSION"
