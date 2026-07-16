#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

ARCH=${1:-amd64}
RUN_RESTORE=${RUN_RESTORE:-0}
ENV_FILE=.env.smoke
COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml -f deploy/compose/compose.smoke.yml"
BASE_COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml"

cleanup() {
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  rm -rf backups
}
trap cleanup EXIT HUP INT TERM

cp .env.example "$ENV_FILE"
sed -i \
  -e 's|^NEXTBUF_IMAGE=.*|NEXTBUF_IMAGE=nextbuf-smoke|' \
  -e 's|^NEXTBUF_VERSION=.*|NEXTBUF_VERSION=0.12.0|' \
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
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE config --quiet
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres redis mailpit
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps web worker
sleep 8
if curl --fail --silent http://127.0.0.1:3100/health/ready >/dev/null 2>&1; then
  echo "Web became ready before setup" >&2
  exit 1
fi
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE logs web worker | grep -Eq 'preflight|dependencies are unavailable|setup has not completed'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE rm -sf web worker
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE run --rm setup
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps web worker

deadline=$(( $(date +%s) + 180 ))
until curl --fail --silent http://127.0.0.1:3100/health/ready >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$deadline" ] || {
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE ps
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE logs web worker setup
    exit 1
  }
  sleep 2
done

response=$(curl --fail-with-body --silent \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Smoke Admin","username":"smoke_admin","email":"smoke-admin@nextbuf.test","password":"smoke-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
printf '%s' "$response" | grep -q '"ok":true'

repeat_status=$(curl --silent -o /tmp/nextbuf-setup-repeat.json -w '%{http_code}' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-smoke-setup-token-at-least-32-characters","name":"Other Admin","username":"other_admin","email":"other-admin@nextbuf.test","password":"other-admin-password-12345"}' \
  http://127.0.0.1:3100/api/setup)
[ "$repeat_status" = 409 ]

deadline=$(( $(date +%s) + 180 ))
until curl --fail --silent http://127.0.0.1:3100/health/worker >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$deadline" ] || exit 1
  sleep 2
done

NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml ./nextbufctl doctor
printf 'attachment-smoke-%s\n' "$ARCH" | NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat > /app/data/uploads/restore-proof.txt'

if [ "$RUN_RESTORE" = 1 ]; then
  NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml ./nextbufctl backup
  backup=$(find backups -maxdepth 1 -name 'nextbuf-*.tar.gz' -print | sort | tail -n 1)
  [ -n "$backup" ]
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE rm -sf mailpit
  NEXTBUFCTL_ASSUME_YES=1 NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
    ./nextbufctl restore "$backup" --empty-install --restore-config --yes
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat /app/data/uploads/restore-proof.txt' | grep -q "attachment-smoke-$ARCH"
  curl --fail --silent http://127.0.0.1:3100/api/setup | grep -q '"complete":true'
fi

NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps
