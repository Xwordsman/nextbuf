#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

ARCH=${1:-amd64}
BASELINE_VERSION=${NEXTBUF_UPGRADE_BASELINE:-1.0.0}
TARGET_VERSION=${NEXTBUF_SMOKE_VERSION:?Set NEXTBUF_SMOKE_VERSION}
TARGET_CORE=${TARGET_VERSION%%-*}
MISMATCH_VERSION=$(printf '%s' "$TARGET_CORE" | awk -F. '{ printf "%d.%d.%d-mismatch.1", $1, $2, $3 + 1 }')
REGISTRY_NAME="nextbuf-patch-upgrade-registry-$$"
REGISTRY_ADDRESS=127.0.0.1:5511
UPGRADE_IMAGE="$REGISTRY_ADDRESS/nextbuf"
ENV_FILE=.env.patch-upgrade-smoke
BACKUP_DIR="$ROOT/backups-patch-upgrade-smoke"
BASELINE_MIGRATION_COUNT=16
FINAL_MIGRATION=20260731180000_email_delivery_attempt_fencing
FINAL_MIGRATION_CHECKSUM=b3f57da005d1c547bbe59ce9b4c9c97acd0f40731119d538a3a9179f665de5a9
COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml -f deploy/compose/compose.smoke.yml"
BASE_COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml"
MAILPIT_API_URL=http://127.0.0.1:38025
SMOKE_STAGE=bootstrap
SMOKE_CHECKPOINT=initializing

stage() {
  SMOKE_STAGE=$1
  SMOKE_CHECKPOINT=starting
  printf '==> %s\n' "$SMOKE_STAGE"
}

checkpoint() {
  SMOKE_CHECKPOINT=$1
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

diagnose_failure() {
  printf 'Patch upgrade smoke stage: %s\n' "$SMOKE_STAGE" >&2
  printf 'Patch upgrade smoke checkpoint: %s\n' "$SMOKE_CHECKPOINT" >&2
  if [ "${GITHUB_ACTIONS:-false}" = true ]; then
    printf '::error file=tests/smoke/docker-patch-upgrade-smoke.sh,title=Patch upgrade smoke failed::Stage: %s; checkpoint: %s\n' \
      "$SMOKE_STAGE" "$SMOKE_CHECKPOINT"
  fi
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE ps -a >&2 2>&1 || true
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE logs --no-color --tail=120 \
    postgres redis mailpit setup web worker >&2 2>&1 || true
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then diagnose_failure; fi
  if [ -f "$ENV_FILE" ]; then
    NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  docker rm -f "$REGISTRY_NAME" >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' HUP INT TERM

[ "$TARGET_VERSION" != "$BASELINE_VERSION" ] || {
  printf 'Patch upgrade smoke requires a target newer than %s\n' "$BASELINE_VERSION" >&2
  exit 1
}
oldest=$(printf '%s\n%s\n' "$BASELINE_VERSION" "$TARGET_VERSION" | sort -V | head -n 1)
[ "$oldest" = "$BASELINE_VERSION" ] || {
  printf 'Patch upgrade target %s is older than baseline %s\n' \
    "$TARGET_VERSION" "$BASELINE_VERSION" >&2
  exit 1
}

stage 'publish the released baseline and tested patch to a local registry'
checkpoint 'start local registry'
docker run -d --name "$REGISTRY_NAME" -p "$REGISTRY_ADDRESS:5000" registry:2.8.3 >/dev/null
wait_for_url "http://$REGISTRY_ADDRESS/v2/" 120
checkpoint 'pull and publish baseline and candidate images'
docker pull "ghcr.io/xwordsman/nextbuf:$BASELINE_VERSION"
docker image inspect "nextbuf-smoke:$TARGET_VERSION" >/dev/null
docker tag "ghcr.io/xwordsman/nextbuf:$BASELINE_VERSION" "$UPGRADE_IMAGE:$BASELINE_VERSION"
docker tag "nextbuf-smoke:$TARGET_VERSION" "$UPGRADE_IMAGE:$TARGET_VERSION"
docker tag "nextbuf-smoke:$TARGET_VERSION" "$UPGRADE_IMAGE:$MISMATCH_VERSION"
docker push "$UPGRADE_IMAGE:$BASELINE_VERSION"
docker push "$UPGRADE_IMAGE:$TARGET_VERSION"
docker push "$UPGRADE_IMAGE:$MISMATCH_VERSION"

stage 'start the immutable v1.0.0 baseline'
checkpoint 'render patch upgrade configuration'
cp .env.example "$ENV_FILE"
sed -i \
  -e "s|^NEXTBUF_IMAGE=.*|NEXTBUF_IMAGE=$UPGRADE_IMAGE|" \
  -e "s|^NEXTBUF_VERSION=.*|NEXTBUF_VERSION=$BASELINE_VERSION|" \
  -e 's|^WEB_PORT=.*|WEB_PORT=3200|' \
  -e 's|^APP_URL=.*|APP_URL=http://127.0.0.1:3200|' \
  -e 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=nextbuf-patch-upgrade-postgres|' \
  -e 's|^REDIS_PASSWORD=.*|REDIS_PASSWORD=nextbuf-patch-upgrade-redis|' \
  -e 's|^AUTH_SECRET=.*|AUTH_SECRET=nextbuf-patch-upgrade-auth-secret-at-least-32-characters|' \
  -e 's|^SETUP_TOKEN=.*|SETUP_TOKEN=nextbuf-patch-upgrade-setup-token-at-least-32-characters|' \
  -e 's|^MAIL_PAYLOAD_KEY=.*|MAIL_PAYLOAD_KEY=SoxCSq6+35KG9qqH7JHtneowihiWs8hjtqqI37UhPQw=|' \
  -e 's|^SMTP_HOST=.*|SMTP_HOST=mailpit|' \
  -e 's|^SMTP_FROM=.*|SMTP_FROM=NextBuf Patch Upgrade <noreply@nextbuf.test>|' \
  "$ENV_FILE"
mkdir -p "$BACKUP_DIR"
checkpoint 'validate Compose configuration'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE config --quiet
checkpoint 'start baseline dependencies and setup'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres redis mailpit
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE run --rm setup
checkpoint 'start baseline Web and Worker'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps web worker
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage 'create durable identity, content and attachment facts on v1.0.0'
checkpoint 'create and verify the baseline administrator'
response=$(curl --fail-with-body --silent \
  -H 'origin: http://127.0.0.1:3200' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-patch-upgrade-setup-token-at-least-32-characters","name":"Patch Upgrade Admin","username":"patch_upgrade_admin","email":"patch-upgrade-admin@nextbuf.test","password":"patch-upgrade-admin-password-12345"}' \
  http://127.0.0.1:3200/api/setup)
printf '%s' "$response" | grep -q '"ok":true'
sh tests/smoke/verify-mailpit-user.sh \
  "$MAILPIT_API_URL" patch-upgrade-admin@nextbuf.test http://127.0.0.1:3200
checkpoint 'create attachment object'
printf 'patch-upgrade-proof-%s\n' "$ARCH" | \
  NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup \
    -ec 'cat > /app/data/uploads/patch-upgrade-proof.txt'
attachment_checksum=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps \
  --entrypoint sh setup -ec 'sha256sum /app/data/uploads/patch-upgrade-proof.txt' \
  | awk '{ print $1 }' | tr -d '\r')
attachment_size=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps \
  --entrypoint sh setup -ec 'wc -c < /app/data/uploads/patch-upgrade-proof.txt' \
  | tr -d ' \r')
printf '%s\n' "$attachment_checksum" | grep -Eq '^[[:xdigit:]]{64}$'
printf '%s\n' "$attachment_size" | grep -Eq '^[1-9][0-9]*$'
checkpoint 'insert stable community references'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<SQL
INSERT INTO community_nodes (
  id, slug, name, description, color, icon, sort_order, visibility, updated_at
) VALUES (
  '21000000-0000-4000-8000-000000000001', 'patch-upgrade-proof',
  'Patch upgrade proof', 'Stable v1.0.0 patch fixture', '#334455', 'grid', 10,
  'public', CURRENT_TIMESTAMP
);
INSERT INTO community_topics (
  id, node_id, author_id, title, status, published_at, last_activity_at, updated_at
) VALUES (
  '21000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000001',
  (SELECT id FROM users WHERE email = 'patch-upgrade-admin@nextbuf.test'),
  'Durable patch upgrade topic', 'published', CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
INSERT INTO community_posts (
  id, topic_id, author_id, position, status, body_source, updated_at
) VALUES (
  '21000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000002',
  (SELECT id FROM users WHERE email = 'patch-upgrade-admin@nextbuf.test'),
  1, 'published', 'Durable patch upgrade body', CURRENT_TIMESTAMP
);
INSERT INTO community_post_revisions (
  id, post_id, editor_id, version, title, body_source, source
) VALUES (
  '21000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000003',
  (SELECT id FROM users WHERE email = 'patch-upgrade-admin@nextbuf.test'),
  1, 'Durable patch upgrade topic', 'Durable patch upgrade body', 'create'
);
INSERT INTO community_attachments (
  id, uploader_id, storage_driver, storage_key, original_name, content_type,
  kind, status, size_bytes, checksum_sha256, updated_at
) VALUES (
  '21000000-0000-4000-8000-000000000005',
  (SELECT id FROM users WHERE email = 'patch-upgrade-admin@nextbuf.test'),
  'local', 'patch-upgrade-proof.txt', 'patch-upgrade-proof.txt', 'text/plain',
  'file', 'ready', $attachment_size, '$attachment_checksum', CURRENT_TIMESTAMP
);
INSERT INTO community_post_attachments (post_id, attachment_id) VALUES (
  '21000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000005'
);
INSERT INTO community_revision_attachments (revision_id, attachment_id) VALUES (
  '21000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000005'
);
SQL

checkpoint 'prove the baseline already contains the complete 16-migration schema'
baseline_migrations=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"' \
  | tr -d '\r')
[ "$baseline_migrations" = "$BASELINE_MIGRATION_COUNT" ]
baseline_final_checksum=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"SELECT checksum FROM _prisma_migrations WHERE migration_name = '$FINAL_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL\"" \
  | tr -d '\r')
[ "$baseline_final_checksum" = "$FINAL_MIGRATION_CHECKSUM" ]

stage 'reject an image whose tag and embedded patch version disagree'
checkpoint 'run mismatched version probe'
if NEXTBUFCTL_ASSUME_YES=1 \
  NEXTBUF_ENV_FILE="$ENV_FILE" \
  NEXTBUF_COMPOSE_FILE=compose.yml \
  NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl upgrade "$MISMATCH_VERSION"; then
  printf 'Patch upgrade accepted an image whose embedded version did not match its tag\n' >&2
  exit 1
fi
grep -q "^NEXTBUF_VERSION=$BASELINE_VERSION$" "$ENV_FILE"
if find "$BACKUP_DIR" -maxdepth 1 -name 'nextbuf-*.tar.gz' -print -quit | grep -q .; then
  printf 'Version mismatch created a backup before the upgrade was eligible to start\n' >&2
  exit 1
fi
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage 'perform the no-migration v1.0.0 to v1.0.1 acceptance-gated upgrade'
checkpoint 'upgrade with database and attachment verification'
NEXTBUFCTL_ASSUME_YES=1 \
  NEXTBUF_ENV_FILE="$ENV_FILE" \
  NEXTBUF_COMPOSE_FILE=compose.yml \
  NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl upgrade "$TARGET_VERSION" --verify-objects

checkpoint 'verify acceptance evidence'
comparison_report=$(find "$BACKUP_DIR" -maxdepth 1 \
  -name "acceptance-$BASELINE_VERSION-to-$TARGET_VERSION-*-comparison.json" \
  -print | sort | tail -n 1)
[ -n "$comparison_report" ]
[ -s "$comparison_report" ]
[ "$(stat -c '%a' "$comparison_report")" = 600 ]
[ -s "$comparison_report.SHA256" ]
(cd "$(dirname "$comparison_report")" && sha256sum -c "$(basename "$comparison_report.SHA256")")
node - "$comparison_report" "$BASELINE_VERSION" "$TARGET_VERSION" <<'NODE'
const fs = require("node:fs");
const [comparisonPath, baselineVersion, targetVersion] = process.argv.slice(2);
const comparison = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
if (comparison.format !== "nextbuf-acceptance-comparison-v1") throw new Error("format");
if (comparison.status !== "pass") throw new Error("status");
if (comparison.sourceVersion !== baselineVersion) throw new Error("source version");
if (comparison.targetVersion !== targetVersion) throw new Error("target version");
if (!Array.isArray(comparison.issues) || comparison.issues.length !== 0) {
  throw new Error("comparison issues");
}
if (comparison.privacy?.rawIdentifiersIncluded !== false) throw new Error("raw identifiers");
if (comparison.privacy?.secretsIncluded !== false) throw new Error("secrets");
NODE

stage 'verify target identity, unchanged schema and durable facts'
checkpoint 'verify healthy target services and version identity'
grep -q "^NEXTBUF_VERSION=$TARGET_VERSION$" "$ENV_FILE"
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180
curl --fail --silent http://127.0.0.1:3200/api/version | grep -q "\"version\":\"$TARGET_VERSION\""
runtime_version=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT value->>'\''version'\'' FROM system_state WHERE key = '\''runtime.initialized'\''"' \
  | tr -d '\r')
[ "$runtime_version" = "$TARGET_VERSION" ]

checkpoint 'verify no migration or durable reference changed'
target_state=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"SELECT
    (SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || '|' ||
    (SELECT checksum FROM _prisma_migrations WHERE migration_name = '$FINAL_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) || '|' ||
    (SELECT COUNT(*) FROM users WHERE email = 'patch-upgrade-admin@nextbuf.test') || '|' ||
    (SELECT COUNT(*) FROM community_topics WHERE id = '21000000-0000-4000-8000-000000000002' AND title = 'Durable patch upgrade topic') || '|' ||
    (SELECT COUNT(*) FROM community_posts WHERE id = '21000000-0000-4000-8000-000000000003' AND position = 1 AND body_source = 'Durable patch upgrade body') || '|' ||
    (SELECT COUNT(*) FROM community_post_attachments WHERE post_id = '21000000-0000-4000-8000-000000000003' AND attachment_id = '21000000-0000-4000-8000-000000000005')\"" \
  | tr -d '\r')
[ "$target_state" = "$BASELINE_MIGRATION_COUNT|$FINAL_MIGRATION_CHECKSUM|1|1|1|1" ]
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup \
  -ec 'sha256sum /app/data/uploads/patch-upgrade-proof.txt' \
  | grep -q "$attachment_checksum"

checkpoint 'verify backup, doctor and service state'
find "$BACKUP_DIR" -maxdepth 1 -name "nextbuf-$BASELINE_VERSION-*.tar.gz" -print -quit | grep -q .
doctor_report=/tmp/nextbuf-patch-upgrade-doctor-$$.log
NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
  timeout --signal=TERM --kill-after=5s 60s ./nextbufctl doctor >"$doctor_report" 2>&1
sh tests/smoke/assert-doctor-continuity-warning.sh "$doctor_report"
rm -f "$doctor_report"
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps
