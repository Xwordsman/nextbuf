#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

ARCH=${1:-amd64}
BASELINE_VERSION=${NEXTBUF_UPGRADE_BASELINE:-0.13.10}
TARGET_VERSION=${NEXTBUF_SMOKE_VERSION:?Set NEXTBUF_SMOKE_VERSION}
TARGET_CORE=${TARGET_VERSION%%-*}
MISMATCH_VERSION=$(printf '%s' "$TARGET_CORE" | awk -F. '{ printf "%d.%d.%d-mismatch.1", $1, $2, $3 + 1 }')
REGISTRY_NAME="nextbuf-upgrade-registry-$$"
REGISTRY_ADDRESS=127.0.0.1:5510
UPGRADE_IMAGE="$REGISTRY_ADDRESS/nextbuf"
ENV_FILE=.env.upgrade-smoke
BACKUP_DIR="$ROOT/backups-upgrade-smoke"
BASELINE_LAST_MIGRATION=20260720090000_editor_session_idempotency
BASELINE_LAST_CHECKSUM=79932f8f3aa65f5f24eea9c7139ea65b3ce3332504606ed2c95be157a964d2f4
FINAL_CANDIDATE_CHECKSUM=b3f57da005d1c547bbe59ce9b4c9c97acd0f40731119d538a3a9179f665de5a9
CHECKSUM_REPORT=/tmp/nextbuf-upgrade-checksum-$$.log
P3009_REPORT=/tmp/nextbuf-upgrade-p3009-$$.log
MARKER_REPORT=/tmp/nextbuf-upgrade-marker-$$.log
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

report_error() {
  message=$1
  printf '%s\n' "$message" >&2
  if [ "${GITHUB_ACTIONS:-false}" = true ]; then
    encoded=$(printf '%s' "$message" | tr '\r\n' '  ' | sed 's/%/%25/g')
    printf '::error file=tests/smoke/docker-upgrade-smoke.sh,title=Upgrade smoke command failed::%s\n' \
      "$encoded"
  fi
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

expect_doctor_continuity_warning() {
  report="/tmp/nextbuf-upgrade-doctor-continuity-$$.log"
  if ! NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml \
    timeout --signal=TERM --kill-after=5s 60s ./nextbufctl doctor >"$report" 2>&1; then
    cat "$report" >&2
    rm -f "$report"
    return 1
  fi
  if ! sh tests/smoke/assert-doctor-continuity-warning.sh "$report"; then
    printf 'Upgraded doctor did not report the expected administrator continuity warning\n' >&2
    cat "$report" >&2
    rm -f "$report"
    return 1
  fi
  cat "$report"
  rm -f "$report"
}

diagnose_failure() {
  printf 'Upgrade smoke stage: %s\n' "$SMOKE_STAGE" >&2
  printf 'Upgrade smoke checkpoint: %s\n' "$SMOKE_CHECKPOINT" >&2
  if [ "${GITHUB_ACTIONS:-false}" = true ]; then
    printf '::error file=tests/smoke/docker-upgrade-smoke.sh,title=Upgrade smoke failed::Stage: %s; checkpoint: %s\n' \
      "$SMOKE_STAGE" "$SMOKE_CHECKPOINT"
  fi
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE ps -a >&2 2>&1 || true
  NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE logs --no-color --tail=100 \
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
  rm -f "$ENV_FILE" "$CHECKSUM_REPORT" "$P3009_REPORT" "$MARKER_REPORT"
  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' HUP INT TERM

[ "$TARGET_VERSION" != "$BASELINE_VERSION" ] || {
  printf 'Upgrade smoke requires a target newer than %s\n' "$BASELINE_VERSION" >&2
  exit 1
}
oldest=$(printf '%s\n%s\n' "$BASELINE_VERSION" "$TARGET_VERSION" | sort -V | head -n 1)
[ "$oldest" = "$BASELINE_VERSION" ] || {
  printf 'Upgrade target %s is older than baseline %s\n' "$TARGET_VERSION" "$BASELINE_VERSION" >&2
  exit 1
}

stage 'publish baseline and candidate images to a local registry'
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

stage 'configure and start the supported baseline'
checkpoint 'render upgrade compose configuration'
cp .env.example "$ENV_FILE"
checkpoint 'rewrite upgrade environment values'
sed -i \
  -e "s|^NEXTBUF_IMAGE=.*|NEXTBUF_IMAGE=$UPGRADE_IMAGE|" \
  -e "s|^NEXTBUF_VERSION=.*|NEXTBUF_VERSION=$BASELINE_VERSION|" \
  -e 's|^WEB_PORT=.*|WEB_PORT=3200|' \
  -e 's|^APP_URL=.*|APP_URL=http://127.0.0.1:3200|' \
  -e 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=nextbuf-upgrade-postgres|' \
  -e 's|^REDIS_PASSWORD=.*|REDIS_PASSWORD=nextbuf-upgrade-redis|' \
  -e 's|^AUTH_SECRET=.*|AUTH_SECRET=nextbuf-upgrade-auth-secret-at-least-32-characters|' \
  -e 's|^SETUP_TOKEN=.*|SETUP_TOKEN=nextbuf-upgrade-setup-token-at-least-32-characters|' \
  -e 's|^MAIL_PAYLOAD_KEY=.*|MAIL_PAYLOAD_KEY=SoxCSq6+35KG9qqH7JHtneowihiWs8hjtqqI37UhPQw=|' \
  -e 's|^SMTP_HOST=.*|SMTP_HOST=mailpit|' \
  -e 's|^SMTP_FROM=.*|SMTP_FROM=NextBuf Upgrade <noreply@nextbuf.test>|' \
  -e 's|^AUTH_REGISTRATION_MODE=.*|AUTH_REGISTRATION_MODE=invite|' \
  "$ENV_FILE"
mkdir -p "$BACKUP_DIR"
checkpoint 'validate baseline smoke compose files'
if ! config_error=$(NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE config --quiet 2>&1); then
  report_error "$config_error"
  exit 1
fi
checkpoint 'start baseline dependencies'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres redis mailpit
checkpoint 'run baseline setup'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE run --rm setup
checkpoint 'start baseline web and worker'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps web worker
checkpoint 'wait for baseline health'
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage 'create durable baseline identity and attachment fixtures'
checkpoint 'create baseline administrator'
response=$(curl --fail-with-body --silent \
  -H 'origin: http://127.0.0.1:3200' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-upgrade-setup-token-at-least-32-characters","name":"Upgrade Admin","username":"upgrade_admin","email":"upgrade-admin@nextbuf.test","password":"upgrade-admin-password-12345"}' \
  http://127.0.0.1:3200/api/setup)
printf '%s' "$response" | grep -q '"ok":true'
checkpoint 'verify baseline administrator email through Mailpit'
sh tests/smoke/verify-mailpit-user.sh \
  "$MAILPIT_API_URL" upgrade-admin@nextbuf.test http://127.0.0.1:3200
checkpoint 'create baseline attachment file'
printf 'upgrade-proof-%s\n' "$ARCH" | NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat > /app/data/uploads/upgrade-proof.txt'
attachment_checksum=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'sha256sum /app/data/uploads/upgrade-proof.txt' | awk '{ print $1 }' | tr -d '\r')
printf '%s\n' "$attachment_checksum" | grep -Eq '^[[:xdigit:]]{64}$'
checkpoint 'insert baseline database fixtures'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO community_nodes (
  id, slug, name, description, color, icon, sort_order, visibility, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000001', 'upgrade-proof', 'Upgrade proof',
  'Durable upgrade fixture', '#334455', 'grid', 10, 'public', CURRENT_TIMESTAMP
);
INSERT INTO users (
  id, name, email, email_verified, status, activated_at, username,
  deletion_requested_at, deletion_scheduled_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000010',
  'Upgrade deletion member', 'upgrade-deletion@nextbuf.test', TRUE, 'active',
  CURRENT_TIMESTAMP - INTERVAL '30 days', 'upgrade_delete',
  CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP - INTERVAL '1 day',
  CURRENT_TIMESTAMP
);
INSERT INTO auth_accounts (
  id, account_id, provider_id, user_id, password, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000011',
  'upgrade-deletion@nextbuf.test', 'credential',
  '20000000-0000-4000-8000-000000000010', 'upgrade-fixture-password-hash',
  CURRENT_TIMESTAMP
);
INSERT INTO users (
  id, name, email, email_verified, status, activated_at, username,
  deletion_requested_at, deletion_scheduled_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000020',
  'Legacy deleted member', 'legacy-deleted@nextbuf.test', TRUE, 'deleted',
  CURRENT_TIMESTAMP - INTERVAL '60 days', 'legacy_deleted',
  CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP + INTERVAL '30 days',
  CURRENT_TIMESTAMP
);
UPDATE profiles
SET bio = 'Legacy private profile must be removed', updated_at = CURRENT_TIMESTAMP
WHERE user_id = '20000000-0000-4000-8000-000000000020';
INSERT INTO auth_accounts (
  id, account_id, provider_id, user_id, password, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000021',
  'legacy-deleted@nextbuf.test', 'credential',
  '20000000-0000-4000-8000-000000000020', 'legacy-fixture-password-hash',
  CURRENT_TIMESTAMP
);
INSERT INTO auth_sessions (
  id, expires_at, token, updated_at, user_id
) VALUES (
  '20000000-0000-4000-8000-000000000022',
  CURRENT_TIMESTAMP + INTERVAL '30 days', 'legacy-deleted-session', CURRENT_TIMESTAMP,
  '20000000-0000-4000-8000-000000000020'
);
INSERT INTO auth_verifications (
  id, identifier, value, expires_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000023', repeat('f', 64),
  '20000000-0000-4000-8000-000000000020',
  CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP
);
INSERT INTO email_deliveries (
  id, kind, recipient, subject, ciphertext, initialization_vector, auth_tag,
  status, attempts, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000024', 'password-reset',
  'legacy-deleted@nextbuf.test', 'Legacy private mail', 'legacy-private-ciphertext',
  repeat('0', 24), repeat('1', 24), 'failed', 5,
  'legacy failure for legacy-deleted@nextbuf.test', CURRENT_TIMESTAMP
);
INSERT INTO notifications (
  id, recipient_id, actor_id, type, dedupe_key, snapshot, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000026',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  '20000000-0000-4000-8000-000000000020', 'reply',
  'upgrade-legacy-actor-notification',
  '{"actorName":"Legacy deleted member","actorUsername":"legacy_deleted"}'::jsonb,
  CURRENT_TIMESTAMP
);
INSERT INTO email_deliveries (
  id, kind, recipient, subject, ciphertext, initialization_vector, auth_tag,
  status, attempts, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000025', 'notification-reply',
  'upgrade-admin@nextbuf.test', 'Legacy actor notification',
  'legacy-actor-private-ciphertext', repeat('2', 24), repeat('3', 24),
  'failed', 5, 'legacy actor identity leaked in provider error', CURRENT_TIMESTAMP
);
INSERT INTO notification_deliveries (
  id, notification_id, channel, status, email_delivery_id, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000027',
  '20000000-0000-4000-8000-000000000026', 'email', 'failed',
  '20000000-0000-4000-8000-000000000025', CURRENT_TIMESTAMP
);
INSERT INTO outbox_events (
  id, topic, payload, idempotency_key, published_at, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000028',
  'nextbuf.mail.delivery.send',
  '{"deliveryId":"20000000-0000-4000-8000-000000000025"}'::jsonb,
  'upgrade-legacy-actor-mail', CURRENT_TIMESTAMP,
  'legacy actor identity leaked in outbox error', CURRENT_TIMESTAMP
);
INSERT INTO worker_job_failures (
  id, queue_name, job_id, job_name, outbox_event_id, attempts, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000029', 'system',
  'upgrade-legacy-actor-mail', 'outbox-event',
  '20000000-0000-4000-8000-000000000028', 5,
  'legacy actor identity leaked in worker error', CURRENT_TIMESTAMP
);
INSERT INTO notification_preferences (
  user_id, type, in_app_enabled, email_enabled, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000020', 'reply', TRUE, TRUE, CURRENT_TIMESTAMP
);
INSERT INTO community_topics (
  id, node_id, author_id, title, status, published_at, last_activity_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000012',
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000010',
  'Deletion member public topic', 'published', CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
INSERT INTO community_posts (
  id, topic_id, author_id, position, status, body_source, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000013',
  '20000000-0000-4000-8000-000000000012',
  '20000000-0000-4000-8000-000000000010',
  1, 'published', 'Public content must survive final deletion', CURRENT_TIMESTAMP
);
INSERT INTO community_post_revisions (
  id, post_id, editor_id, version, title, body_source, source
) VALUES (
  '20000000-0000-4000-8000-000000000014',
  '20000000-0000-4000-8000-000000000013',
  '20000000-0000-4000-8000-000000000010',
  1, 'Deletion member public topic',
  'Public content must survive final deletion', 'create'
);
INSERT INTO community_topics (
  id, node_id, author_id, title, status, deleted_from_status,
  deleted_at, last_activity_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000015',
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000010',
  'Deleted private draft', 'deleted', 'draft', CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
INSERT INTO community_posts (
  id, topic_id, author_id, position, status, body_source, deleted_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000016',
  '20000000-0000-4000-8000-000000000015',
  '20000000-0000-4000-8000-000000000010',
  1, 'deleted', 'Private draft lineage must be removed', CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
INSERT INTO community_post_revisions (
  id, post_id, editor_id, version, title, body_source, source
) VALUES (
  '20000000-0000-4000-8000-000000000017',
  '20000000-0000-4000-8000-000000000016',
  '20000000-0000-4000-8000-000000000010',
  1, 'Deleted private draft', 'Private draft lineage must be removed', 'create'
);
INSERT INTO community_topics (
  id, node_id, author_id, title, status, reply_count, next_post_position,
  published_at, last_activity_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  'Durable upgrade topic', 'published', 1, 3,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
INSERT INTO community_posts (
  id, topic_id, author_id, position, status, body_source, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  1, 'published', 'Durable upgrade body', CURRENT_TIMESTAMP
);
INSERT INTO community_post_revisions (
  id, post_id, editor_id, version, title, body_source, source
) VALUES (
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000003',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  1, 'Durable upgrade topic', 'Durable upgrade body', 'create'
);
INSERT INTO community_posts (
  id, topic_id, author_id, position, status, body_source, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000002',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  2, 'published', 'Durable upgrade reply', CURRENT_TIMESTAMP
);
INSERT INTO community_post_revisions (
  id, post_id, editor_id, version, title, body_source, source
) VALUES (
  '20000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000005',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  1, NULL, 'Durable upgrade reply', 'create'
);
INSERT INTO community_post_drafts (
  id, topic_id, author_id, quoted_post_id, body_source, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000002',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  '20000000-0000-4000-8000-000000000005',
  'Durable upgrade reply draft', CURRENT_TIMESTAMP
);
INSERT INTO community_attachments (
  id, uploader_id, storage_driver, storage_key, original_name, content_type,
  kind, status, size_bytes, checksum_sha256, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000008',
  (SELECT id FROM users WHERE email = 'upgrade-admin@nextbuf.test'),
  'local', 'upgrade-proof.txt', 'upgrade-proof.txt', 'text/plain',
  'file', 'ready', 20, repeat('0', 64), CURRENT_TIMESTAMP
);
INSERT INTO community_post_attachments (post_id, attachment_id) VALUES (
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000008'
);
INSERT INTO community_revision_attachments (revision_id, attachment_id) VALUES (
  '20000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000008'
);
INSERT INTO community_post_draft_attachments (draft_id, attachment_id) VALUES (
  '20000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000008'
);
INSERT INTO email_deliveries (
  id, kind, recipient, subject, ciphertext, initialization_vector, auth_tag,
  status, attempts, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000018', 'password-reset',
  'upgrade-admin@nextbuf.test', 'Historical mail failure', 'ciphertext',
  repeat('0', 24), repeat('0', 32), 'failed', 5,
  'historical provider failure', CURRENT_TIMESTAMP
);
INSERT INTO outbox_events (
  id, topic, payload, idempotency_key, published_at, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000019',
  'nextbuf.identity.email.send',
  '{"deliveryId":"20000000-0000-4000-8000-000000000018"}'::jsonb,
  'upgrade-historical-mail-failure', CURRENT_TIMESTAMP,
  'historical provider failure', CURRENT_TIMESTAMP
);
INSERT INTO worker_job_failures (
  id, queue_name, job_id, job_name, outbox_event_id, attempts, last_error, updated_at
) VALUES (
  '20000000-0000-4000-8000-00000000001a', 'system',
  'upgrade-historical-mail-failure', 'outbox-event',
  '20000000-0000-4000-8000-000000000019', 5,
  'historical provider failure', CURRENT_TIMESTAMP
);
INSERT INTO outbox_events (
  id, topic, payload, idempotency_key, published_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000030',
  'nextbuf.runtime.probe', '{"source":"upgrade-processed-outbox"}'::jsonb,
  'upgrade-processed-outbox', CURRENT_TIMESTAMP - INTERVAL '1 day',
  CURRENT_TIMESTAMP - INTERVAL '1 day'
);
INSERT INTO processed_jobs (
  id, queue_name, job_name, idempotency_key, completed_at
) VALUES (
  '20000000-0000-4000-8000-000000000031', 'system', 'outbox-event',
  'outbox-20000000-0000-4000-8000-000000000030',
  CURRENT_TIMESTAMP - INTERVAL '23 hours'
);
SQL
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<SQL
UPDATE community_attachments
SET checksum_sha256 = '$attachment_checksum'
WHERE id = '20000000-0000-4000-8000-000000000008';
SQL

stage 'reject a drifted immutable migration baseline before candidate DDL'
checkpoint 'stop baseline writers for migration identity verification'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE stop web worker
checkpoint 'verify and corrupt the final baseline checksum'
baseline_checksum=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT checksum FROM _prisma_migrations WHERE migration_name = '\''20260720090000_editor_session_idempotency'\'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL"' | tr -d '\r')
[ "$baseline_checksum" = "$BASELINE_LAST_CHECKSUM" ]
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE _prisma_migrations SET checksum = repeat('\''0'\'', 64) WHERE migration_name = '\''20260720090000_editor_session_idempotency'\'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL"' >/dev/null
checkpoint 'run candidate migration against the drifted baseline'
if NEXTBUF_VERSION="$TARGET_VERSION" NEXTBUF_ENV_FILE="$ENV_FILE" \
  $BASE_COMPOSE run --rm --no-deps setup migrate >"$CHECKSUM_REPORT" 2>&1; then
  printf 'Candidate migration unexpectedly accepted a drifted v0.13.10 checksum\n' >&2
  exit 1
fi
grep -q 'not an exact prefix of the immutable v1.0.0 release migration manifest' "$CHECKSUM_REPORT"
checkpoint 'verify checksum rejection left candidate Schema absent'
candidate_column_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '\''public'\'' AND table_name = '\''users'\'' AND column_name = '\''deletion_finalized_at'\''"' | tr -d '\r')
[ "$candidate_column_count" = 0 ]
checkpoint 'restore the immutable baseline checksum and writers'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"UPDATE _prisma_migrations SET checksum = '$BASELINE_LAST_CHECKSUM' WHERE migration_name = '$BASELINE_LAST_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL\"" >/dev/null
checkpoint 'exclude the final baseline record from initialized history'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"UPDATE _prisma_migrations SET rolled_back_at = CURRENT_TIMESTAMP WHERE migration_name = '$BASELINE_LAST_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL\"" >/dev/null
if NEXTBUF_VERSION="$TARGET_VERSION" NEXTBUF_ENV_FILE="$ENV_FILE" \
  $BASE_COMPOSE run --rm --no-deps setup migrate >"$CHECKSUM_REPORT" 2>&1; then
  printf 'Candidate migration unexpectedly accepted initialized history before v0.13.10\n' >&2
  exit 1
fi
grep -q 'predates the supported immutable v0.13.10 upgrade baseline' "$CHECKSUM_REPORT"
checkpoint 'restore the final baseline record'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '$BASELINE_LAST_MIGRATION' AND finished_at IS NOT NULL\"" >/dev/null
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE up -d --no-deps web worker
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage 'reject a mismatched image before backup or migration'
checkpoint 'run mismatched-image upgrade'
if NEXTBUFCTL_ASSUME_YES=1 \
  NEXTBUF_ENV_FILE="$ENV_FILE" \
  NEXTBUF_COMPOSE_FILE=compose.yml \
  NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl upgrade "$MISMATCH_VERSION"; then
  printf 'Upgrade unexpectedly accepted an image whose internal version did not match its tag\n' >&2
  exit 1
fi
checkpoint 'verify mismatched-image rejection state'
grep -q "^NEXTBUF_VERSION=$BASELINE_VERSION$" "$ENV_FILE"
if find "$BACKUP_DIR" -maxdepth 1 -name 'nextbuf-*.tar.gz' -print -quit | grep -q .; then
  printf 'Version-mismatch rejection created a backup even though migration was not allowed to start\n' >&2
  exit 1
fi
checkpoint 'verify baseline health after mismatch rejection'
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage 'roll back and recover a failed candidate migration'
checkpoint 'inject legacy mail data rejected by the final candidate migration'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE email_deliveries SET attempts = -1 WHERE id = '\''20000000-0000-4000-8000-000000000018'\''"' >/dev/null
checkpoint 'run target upgrade until the transactional migration fails'
if NEXTBUFCTL_ASSUME_YES=1 \
  NEXTBUF_ENV_FILE="$ENV_FILE" \
  NEXTBUF_COMPOSE_FILE=compose.yml \
  NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl upgrade "$TARGET_VERSION"; then
  printf 'Upgrade unexpectedly accepted invalid legacy mail attempts\n' >&2
  exit 1
fi
checkpoint 'verify failed migration state, stopped writers and backup'
grep -q "^NEXTBUF_VERSION=$TARGET_VERSION$" "$ENV_FILE"
[ -z "$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps -q web)" ]
[ -z "$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps -q worker)" ]
failed_upgrade_backup=$(find "$BACKUP_DIR" -maxdepth 1 -name "nextbuf-$BASELINE_VERSION-*.tar.gz" -print | sort | tail -n 1)
[ -n "$failed_upgrade_backup" ]
failure_log=$(find "$BACKUP_DIR" -maxdepth 1 -name "upgrade-$BASELINE_VERSION-to-$TARGET_VERSION-*.log" -print | sort | tail -n 1)
[ -n "$failure_log" ]
grep -q '20260731180000_email_delivery_attempt_fencing' "$failure_log"
candidate_migration_state=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT
    (SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260730120000_account_deletion_finalization'\'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) || '\''|'\'' ||
    (SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260731120000_outbox_processed_status'\'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) || '\''|'\'' ||
    (SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260731180000_email_delivery_attempt_fencing'\'' AND finished_at IS NULL AND rolled_back_at IS NULL) || '\''|'\'' ||
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '\''public'\'' AND table_name = '\''email_deliveries'\'' AND column_name = '\''attempt_token'\'') || '\''|'\'' ||
    (SELECT attempts FROM email_deliveries WHERE id = '\''20000000-0000-4000-8000-000000000018'\'')"' | tr -d '\r')
[ "$candidate_migration_state" = '1|1|1|0|-1' ]
checkpoint 'verify unresolved P3009 state blocks an ordinary retry'
if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm setup >"$P3009_REPORT" 2>&1; then
  printf 'Candidate setup unexpectedly retried an unresolved failed migration\n' >&2
  exit 1
fi
grep -q 'is recorded as failed' "$P3009_REPORT"
checkpoint 'verify drifted failed migration records cannot be resolved'
failed_checksum=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT checksum FROM _prisma_migrations WHERE migration_name = '\''20260731180000_email_delivery_attempt_fencing'\'' AND finished_at IS NULL AND rolled_back_at IS NULL"' | tr -d '\r')
[ "$failed_checksum" = "$FINAL_CANDIDATE_CHECKSUM" ]
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE _prisma_migrations SET checksum = repeat('\''0'\'', 64) WHERE migration_name = '\''20260731180000_email_delivery_attempt_fencing'\'' AND finished_at IS NULL AND rolled_back_at IS NULL"' >/dev/null
if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm setup migrate \
  --resolve-rolled-back 20260731180000_email_delivery_attempt_fencing \
  >"$CHECKSUM_REPORT" 2>&1; then
  printf 'Candidate resolver accepted a drifted failed migration checksum\n' >&2
  exit 1
fi
grep -q 'checksum that differs from the immutable v1.0.0 release migration manifest' "$CHECKSUM_REPORT"
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"UPDATE _prisma_migrations SET checksum = '$FINAL_CANDIDATE_CHECKSUM' WHERE migration_name = '20260731180000_email_delivery_attempt_fencing' AND finished_at IS NULL AND rolled_back_at IS NULL\"" >/dev/null
checkpoint 'verify committed Schema markers cannot be declared rolled back'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER TABLE email_deliveries ADD COLUMN attempt_token UUID"' >/dev/null
if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm setup migrate \
  --resolve-rolled-back 20260731180000_email_delivery_attempt_fencing \
  >"$MARKER_REPORT" 2>&1; then
  printf 'Candidate resolver accepted a migration whose Schema marker exists\n' >&2
  exit 1
fi
grep -q 'left its committed Schema marker email_deliveries.attempt_token' "$MARKER_REPORT"
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER TABLE email_deliveries DROP COLUMN attempt_token"' >/dev/null
checkpoint 'verify resolution is restricted to candidate migration names'
if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm setup migrate \
  --resolve-rolled-back 20260720090000_editor_session_idempotency >/dev/null 2>&1; then
  printf 'Candidate resolver accepted a migration outside the recovery allowlist\n' >&2
  exit 1
fi
checkpoint 'repair the rejected data and resolve the rolled-back transaction'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE email_deliveries SET attempts = 5 WHERE id = '\''20000000-0000-4000-8000-000000000018'\''"' >/dev/null
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm setup migrate \
  --resolve-rolled-back 20260731180000_email_delivery_attempt_fencing
rolled_back_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260731180000_email_delivery_attempt_fencing'\'' AND finished_at IS NULL AND rolled_back_at IS NOT NULL"' | tr -d '\r')
[ "$rolled_back_count" = 1 ]
checkpoint 'verify migration quarantined legacy deleted credentials and mail'
legacy_quarantine=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT
    (u.deletion_requested_at IS NOT NULL AND u.deletion_scheduled_at IS NOT NULL)::int || '\''|'\'' ||
    (u.deletion_scheduled_at <= CURRENT_TIMESTAMP)::int || '\''|'\'' ||
    (SELECT COUNT(*) FROM auth_accounts WHERE user_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM auth_sessions WHERE user_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM auth_verifications WHERE value = u.id::text) || '\''|'\'' ||
    (SELECT COUNT(*) FROM email_deliveries WHERE lower(recipient) = lower(u.email)) || '\''|'\'' ||
    (SELECT COUNT(*) FROM email_deliveries WHERE id = '\''20000000-0000-4000-8000-000000000025'\'') || '\''|'\'' ||
    (SELECT COUNT(*) FROM worker_job_failures WHERE id = '\''20000000-0000-4000-8000-000000000029'\'') || '\''|'\'' ||
    (SELECT (last_error IS NULL)::int FROM outbox_events WHERE id = '\''20000000-0000-4000-8000-000000000028'\'') || '\''|'\'' ||
    (SELECT (email_delivery_id IS NULL)::int FROM notification_deliveries WHERE id = '\''20000000-0000-4000-8000-000000000027'\'')
  FROM users AS u WHERE u.id = '\''20000000-0000-4000-8000-000000000020'\''"' | tr -d '\r')
[ "$legacy_quarantine" = '1|1|0|0|0|0|0|0|1|1' ]
checkpoint 'verify incomplete account deletion state is rejected'
if NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE users SET deletion_scheduled_at = CURRENT_TIMESTAMP WHERE email = '\''upgrade-admin@nextbuf.test'\''"' \
  >/dev/null 2>&1; then
  printf 'Migration accepted an account deletion schedule without a matching request\n' >&2
  exit 1
fi

stage 'retry the tested target after resolving the rolled-back migration'
checkpoint 'retry target setup'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm setup
checkpoint 'restart target web and worker'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE up -d --no-deps web worker
checkpoint 'wait for target health after retry'
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage "verify upgraded version, migrations and durable fixtures"
checkpoint 'verify target HTTP identity and setup state'
grep -q "^NEXTBUF_VERSION=$TARGET_VERSION$" "$ENV_FILE"
curl --fail --silent http://127.0.0.1:3200/api/version | grep -q "\"version\":\"$TARGET_VERSION\""
curl --fail --silent http://127.0.0.1:3200/api/setup | grep -q '"complete":true'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat /app/data/uploads/upgrade-proof.txt' | grep -q "upgrade-proof-$ARCH"
checkpoint 'verify preserved administrator and runtime state'
admin_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM users WHERE email = '\''upgrade-admin@nextbuf.test'\''"' | tr -d '\r')
[ "$admin_count" = 1 ]
runtime_version=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT value->>'\''version'\'' FROM system_state WHERE key = '\''runtime.initialized'\''"' | tr -d '\r')
[ "$runtime_version" = "$TARGET_VERSION" ]
checkpoint 'verify complete migration set'
migration_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260717150000_beta_index_hardening'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$migration_count" = 1 ]
generic_node_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260717200000_remove_builtin_nodes'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$generic_node_migration" = 1 ]
editor_session_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260720090000_editor_session_idempotency'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$editor_session_migration" = 1 ]
account_deletion_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260730120000_account_deletion_finalization'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$account_deletion_migration" = 1 ]
outbox_status_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260731120000_outbox_processed_status'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$outbox_status_migration" = 1 ]
mail_attempt_fencing_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260731180000_email_delivery_attempt_fencing'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$mail_attempt_fencing_migration" = 1 ]
checkpoint 'verify completed Outbox backfill and recovery index'
outbox_processed_backfill=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT (event.processed_at = processed.completed_at)::int FROM outbox_events AS event INNER JOIN processed_jobs AS processed ON processed.queue_name = '\''system'\'' AND processed.idempotency_key = '\''outbox-'\'' || event.id::text WHERE event.id = '\''20000000-0000-4000-8000-000000000030'\''"' | tr -d '\r')
[ "$outbox_processed_backfill" = 1 ]
outbox_recovery_index=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM pg_index AS index INNER JOIN pg_class AS class ON class.oid = index.indexrelid WHERE class.relname = '\''outbox_events_recovery_pending_idx'\'' AND index.indisvalid AND index.indisready AND pg_get_expr(index.indpred, index.indrelid) ILIKE '\''%processed_at IS NULL%published_at IS NOT NULL%'\''"' | tr -d '\r')
[ "$outbox_recovery_index" = 1 ]
checkpoint 'verify historical mail failure backfill and deletion cascade'
mail_failure_delivery=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT
    failure.email_delivery_id::text || '\''|'\'' || failure.last_error || '\''|'\'' ||
    delivery.last_error || '\''|'\'' || event.last_error || '\''|'\'' ||
    (delivery.attempt_token IS NOT NULL)::int || '\''|'\'' || delivery.attempt_generation
  FROM worker_job_failures AS failure
  INNER JOIN email_deliveries AS delivery ON delivery.id = failure.email_delivery_id
  INNER JOIN outbox_events AS event ON event.id = failure.outbox_event_id
  WHERE failure.id = '\''20000000-0000-4000-8000-00000000001a'\''"' | tr -d '\r')
[ "$mail_failure_delivery" = '20000000-0000-4000-8000-000000000018|Mail delivery failed|Mail delivery failed|Mail dispatch failed|1|5' ]
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM email_deliveries WHERE id = '\''20000000-0000-4000-8000-000000000018'\''"' >/dev/null
mail_failure_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM worker_job_failures WHERE id = '\''20000000-0000-4000-8000-00000000001a'\''"' | tr -d '\r')
[ "$mail_failure_count" = 0 ]
checkpoint 'verify preserved community fixtures'
preserved_fixture=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_topics AS topic JOIN community_posts AS post ON post.topic_id = topic.id AND post.position = 1 JOIN community_nodes AS node ON node.id = topic.node_id WHERE node.slug = '\''upgrade-proof'\'' AND topic.title = '\''Durable upgrade topic'\'' AND topic.editor_session_key IS NULL AND post.body_source = '\''Durable upgrade body'\'' AND post.editor_session_key IS NULL"' | tr -d '\r')
[ "$preserved_fixture" = 1 ]
preserved_reply=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_posts WHERE id = '\''20000000-0000-4000-8000-000000000005'\'' AND position = 2 AND status = '\''published'\'' AND body_source = '\''Durable upgrade reply'\'' AND editor_session_key IS NULL AND editor_session_revision IS NULL"' | tr -d '\r')
[ "$preserved_reply" = 1 ]
preserved_reply_draft=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_post_drafts WHERE id = '\''20000000-0000-4000-8000-000000000007'\'' AND quoted_post_id = '\''20000000-0000-4000-8000-000000000005'\'' AND body_source = '\''Durable upgrade reply draft'\'' AND editor_session_key IS NULL AND editor_session_revision IS NULL"' | tr -d '\r')
[ "$preserved_reply_draft" = 1 ]
preserved_attachment=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM community_attachments AS attachment WHERE attachment.id = '\''20000000-0000-4000-8000-000000000008'\'' AND attachment.storage_driver = '\''local'\'' AND attachment.storage_key = '\''upgrade-proof.txt'\'' AND attachment.status = '\''ready'\'' AND EXISTS (SELECT 1 FROM community_post_attachments WHERE post_id = '\''20000000-0000-4000-8000-000000000005'\'' AND attachment_id = attachment.id) AND EXISTS (SELECT 1 FROM community_revision_attachments WHERE revision_id = '\''20000000-0000-4000-8000-000000000006'\'' AND attachment_id = attachment.id) AND EXISTS (SELECT 1 FROM community_post_draft_attachments WHERE draft_id = '\''20000000-0000-4000-8000-000000000007'\'' AND attachment_id = attachment.id)"' | tr -d '\r')
[ "$preserved_attachment" = 1 ]
session_table=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT to_regclass('\''community_reply_editor_sessions'\'') IS NOT NULL"' | tr -d '\r')
[ "$session_table" = t ]
checkpoint 'verify due account finalization after upgrade'
deadline=$(( $(date +%s) + 180 ))
deletion_status=
while [ "$(date +%s)" -lt "$deadline" ]; do
  deletion_status=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT status FROM users WHERE id = '\''20000000-0000-4000-8000-000000000010'\''"' | tr -d '\r')
  [ "$deletion_status" != deleted ] || break
  sleep 2
done
[ "$deletion_status" = deleted ]
deletion_invariants=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT
    (u.deletion_finalized_at IS NOT NULL)::int || '\''|'\'' ||
    (u.email LIKE '\''deleted+%@deleted.invalid'\'')::int || '\''|'\'' ||
    (SELECT COUNT(*) FROM auth_accounts WHERE user_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM community_topics WHERE id = '\''20000000-0000-4000-8000-000000000015'\'') || '\''|'\'' ||
    (SELECT COUNT(*) FROM community_topics WHERE id = '\''20000000-0000-4000-8000-000000000012'\'' AND author_id = u.id AND status = '\''published'\'') || '\''|'\'' ||
    (SELECT COUNT(*) FROM community_posts WHERE id = '\''20000000-0000-4000-8000-000000000013'\'' AND author_id = u.id AND position = 1 AND status = '\''published'\'') || '\''|'\'' ||
    (SELECT COUNT(*) FROM community_post_revisions WHERE id = '\''20000000-0000-4000-8000-000000000014'\'' AND editor_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM username_aliases WHERE username = '\''upgrade_delete'\'' AND user_id = u.id)
  FROM users AS u WHERE u.id = '\''20000000-0000-4000-8000-000000000010'\''"' | tr -d '\r')
[ "$deletion_invariants" = '1|1|0|0|1|1|1|1' ]
checkpoint 'verify legacy deleted account reached a complete immutable tombstone'
legacy_deletion_invariants=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT
    (u.deletion_finalized_at IS NOT NULL)::int || '\''|'\'' ||
    (u.username LIKE '\''deleted-%'\'')::int || '\''|'\'' ||
    (u.email = '\''deleted+'\'' || u.id::text || '\''@deleted.invalid'\'')::int || '\''|'\'' ||
    (SELECT COUNT(*) FROM profiles WHERE user_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM notification_preferences WHERE user_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM username_aliases WHERE username = '\''legacy_deleted'\'' AND user_id = u.id) || '\''|'\'' ||
    (SELECT COUNT(*) FROM notifications WHERE id = '\''20000000-0000-4000-8000-000000000026'\'' AND actor_id IS NULL) || '\''|'\'' ||
    (SELECT COUNT(*) FROM email_deliveries WHERE id = '\''20000000-0000-4000-8000-000000000025'\'')
  FROM users AS u WHERE u.id = '\''20000000-0000-4000-8000-000000000020'\''"' | tr -d '\r')
[ "$legacy_deletion_invariants" = '1|1|1|0|0|1|1|0' ]
checkpoint 'verify backup and final doctor'
find "$BACKUP_DIR" -maxdepth 1 -name "nextbuf-$BASELINE_VERSION-*.tar.gz" -print -quit | grep -q .
expect_doctor_continuity_warning

stage 'restore the baseline and exercise a successful acceptance-gated upgrade'
checkpoint 'remove the smoke-only mail service before the empty-install restore'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE rm -sf mailpit
checkpoint 'restore the failed-upgrade baseline backup and its configuration'
NEXTBUF_ENV_FILE="$ENV_FILE" \
  NEXTBUF_COMPOSE_FILE=compose.yml \
  NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl restore "$failed_upgrade_backup" \
    --empty-install --restore-config --yes
checkpoint 'restore the smoke-only mail service and verify baseline health'
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps mailpit
grep -q "^NEXTBUF_VERSION=$BASELINE_VERSION$" "$ENV_FILE"
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180
checkpoint 'repair the injected baseline fixture before the successful upgrade'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE email_deliveries SET attempts = 5 WHERE id = '\''20000000-0000-4000-8000-000000000018'\''"' >/dev/null
checkpoint 'run the complete target upgrade with attachment verification'
NEXTBUFCTL_ASSUME_YES=1 \
  NEXTBUF_ENV_FILE="$ENV_FILE" \
  NEXTBUF_COMPOSE_FILE=compose.yml \
  NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl upgrade "$TARGET_VERSION" --verify-objects
checkpoint 'locate the successful pre-snapshot, post-snapshot and comparison'
comparison_report=$(find "$BACKUP_DIR" -maxdepth 1 \
  -name "acceptance-$BASELINE_VERSION-to-$TARGET_VERSION-*-comparison.json" \
  -print | sort | tail -n 1)
[ -n "$comparison_report" ]
evidence_prefix=${comparison_report%-comparison.json}
before_snapshot="$evidence_prefix-before.json"
after_snapshot="$evidence_prefix-after.json"
for evidence_file in "$before_snapshot" "$after_snapshot" "$comparison_report"; do
  [ -s "$evidence_file" ]
  [ "$(stat -c '%a' "$evidence_file")" = 600 ]
  [ "$(stat -c '%u' "$evidence_file")" = "$(id -u)" ]
  checksum_file="$evidence_file.SHA256"
  [ -s "$checksum_file" ]
  [ "$(stat -c '%a' "$checksum_file")" = 600 ]
  [ "$(stat -c '%u' "$checksum_file")" = "$(id -u)" ]
  checksum_entry=$(awk 'NF { print $2 }' "$checksum_file")
  [ "$checksum_entry" = "$(basename "$evidence_file")" ]
  (cd "$(dirname "$evidence_file")" && sha256sum -c "$(basename "$checksum_file")")
done
checkpoint 'verify successful object snapshots and comparison contract'
node - "$before_snapshot" "$after_snapshot" "$comparison_report" \
  "$BASELINE_VERSION" "$TARGET_VERSION" <<'NODE'
const fs = require("node:fs");

const [beforePath, afterPath, comparisonPath, baselineVersion, targetVersion] =
  process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
const after = JSON.parse(fs.readFileSync(afterPath, "utf8"));
const comparison = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [phase, snapshot] of [
  ["before", before],
  ["after", after],
]) {
  assert(snapshot.format === "nextbuf-acceptance-snapshot-v1", `${phase} snapshot format`);
  assert(snapshot.storage?.requested === true, `${phase} object verification requested`);
  assert(snapshot.storage?.ok === true, `${phase} object verification passed`);
  assert(snapshot.storage?.originals > 0, `${phase} original attachment counted`);
  assert(snapshot.storage?.missingOriginals === 0, `${phase} original attachment present`);
  assert(snapshot.storage?.checksumMismatches === 0, `${phase} attachment checksum matched`);
  assert(snapshot.privacy?.rawIdentifiersIncluded === false, `${phase} identifiers redacted`);
  assert(snapshot.privacy?.secretsIncluded === false, `${phase} secrets redacted`);
}

assert(before.application?.configuredVersion === baselineVersion, "before configured version");
assert(after.application?.configuredVersion === targetVersion, "after configured version");
assert(comparison.format === "nextbuf-acceptance-comparison-v1", "comparison format");
assert(comparison.status === "pass", "comparison passed");
assert(Array.isArray(comparison.issues) && comparison.issues.length === 0, "comparison issues empty");
assert(comparison.sourceVersion === baselineVersion, "comparison source version");
assert(comparison.targetVersion === targetVersion, "comparison target version");
assert(comparison.privacy?.rawIdentifiersIncluded === false, "comparison identifiers redacted");
assert(comparison.privacy?.secretsIncluded === false, "comparison secrets redacted");
NODE
checkpoint 'verify successful upgrade started healthy target services'
grep -q "^NEXTBUF_VERSION=$TARGET_VERSION$" "$ENV_FILE"
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180
[ -n "$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps -q web)" ]
[ -n "$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps -q worker)" ]

stage 'report upgraded service state'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps
