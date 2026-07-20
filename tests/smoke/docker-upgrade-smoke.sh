#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

ARCH=${1:-amd64}
BASELINE_VERSION=${NEXTBUF_UPGRADE_BASELINE:-0.13.7}
TARGET_VERSION=${NEXTBUF_SMOKE_VERSION:?Set NEXTBUF_SMOKE_VERSION}
REGISTRY_NAME="nextbuf-upgrade-registry-$$"
REGISTRY_ADDRESS=127.0.0.1:5510
UPGRADE_IMAGE="$REGISTRY_ADDRESS/nextbuf"
ENV_FILE=.env.upgrade-smoke
BACKUP_DIR="$ROOT/backups-upgrade-smoke"
COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml -f deploy/compose/compose.smoke.yml"
BASE_COMPOSE="docker compose --env-file $ENV_FILE -f compose.yml"
SMOKE_STAGE=bootstrap

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

diagnose_failure() {
  printf 'Upgrade smoke stage: %s\n' "$SMOKE_STAGE" >&2
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
  rm -f "$ENV_FILE"
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
docker run -d --name "$REGISTRY_NAME" -p "$REGISTRY_ADDRESS:5000" registry:2.8.3 >/dev/null
wait_for_url "http://$REGISTRY_ADDRESS/v2/" 120
docker pull "ghcr.io/xwordsman/nextbuf:$BASELINE_VERSION"
docker image inspect "nextbuf-smoke:$TARGET_VERSION" >/dev/null
docker tag "ghcr.io/xwordsman/nextbuf:$BASELINE_VERSION" "$UPGRADE_IMAGE:$BASELINE_VERSION"
docker tag "nextbuf-smoke:$TARGET_VERSION" "$UPGRADE_IMAGE:$TARGET_VERSION"
docker push "$UPGRADE_IMAGE:$BASELINE_VERSION"
docker push "$UPGRADE_IMAGE:$TARGET_VERSION"

stage 'configure and start the supported baseline'
cp .env.example "$ENV_FILE"
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
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE config --quiet
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d postgres redis mailpit
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE run --rm setup
NEXTBUF_ENV_FILE="$ENV_FILE" $COMPOSE up -d --no-deps web worker
wait_for_url http://127.0.0.1:3200/health/ready 180
wait_for_url http://127.0.0.1:3200/health/worker 180

stage 'create durable baseline identity and attachment fixtures'
response=$(curl --fail-with-body --silent \
  -H 'origin: http://127.0.0.1:3200' \
  -H 'content-type: application/json' \
  -d '{"token":"nextbuf-upgrade-setup-token-at-least-32-characters","name":"Upgrade Admin","username":"upgrade_admin","email":"upgrade-admin@nextbuf.test","password":"upgrade-admin-password-12345"}' \
  http://127.0.0.1:3200/api/setup)
printf '%s' "$response" | grep -q '"ok":true'
printf 'upgrade-proof-%s\n' "$ARCH" | NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat > /app/data/uploads/upgrade-proof.txt'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO community_nodes (
  id, slug, name, description, color, icon, sort_order, visibility, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000001', 'upgrade-proof', 'Upgrade proof',
  'Durable upgrade fixture', '#334455', 'grid', 10, 'public', CURRENT_TIMESTAMP
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
SQL

stage "upgrade $BASELINE_VERSION to $TARGET_VERSION"
NEXTBUFCTL_ASSUME_YES=1 \
NEXTBUF_ENV_FILE="$ENV_FILE" \
NEXTBUF_COMPOSE_FILE=compose.yml \
NEXTBUF_BACKUP_DIR="$BACKUP_DIR" \
  ./nextbufctl upgrade "$TARGET_VERSION"

stage 'verify upgraded version, migrations and durable fixtures'
grep -q "^NEXTBUF_VERSION=$TARGET_VERSION$" "$ENV_FILE"
curl --fail --silent http://127.0.0.1:3200/api/version | grep -q "\"version\":\"$TARGET_VERSION\""
curl --fail --silent http://127.0.0.1:3200/api/setup | grep -q '"complete":true'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE run --rm --no-deps --entrypoint sh setup -ec 'cat /app/data/uploads/upgrade-proof.txt' | grep -q "upgrade-proof-$ARCH"
admin_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM users WHERE email = '\''upgrade-admin@nextbuf.test'\''"' | tr -d '\r')
[ "$admin_count" = 1 ]
runtime_version=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT value->>'\''version'\'' FROM system_state WHERE key = '\''runtime.initialized'\''"' | tr -d '\r')
[ "$runtime_version" = "$TARGET_VERSION" ]
migration_count=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260717150000_beta_index_hardening'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$migration_count" = 1 ]
generic_node_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260717200000_remove_builtin_nodes'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$generic_node_migration" = 1 ]
editor_session_migration=$(NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '\''20260720090000_editor_session_idempotency'\'' AND finished_at IS NOT NULL"' | tr -d '\r')
[ "$editor_session_migration" = 1 ]
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
find "$BACKUP_DIR" -maxdepth 1 -name "nextbuf-$BASELINE_VERSION-*.tar.gz" -print -quit | grep -q .
NEXTBUF_ENV_FILE="$ENV_FILE" NEXTBUF_COMPOSE_FILE=compose.yml ./nextbufctl doctor

stage 'report upgraded service state'
NEXTBUF_ENV_FILE="$ENV_FILE" $BASE_COMPOSE ps
