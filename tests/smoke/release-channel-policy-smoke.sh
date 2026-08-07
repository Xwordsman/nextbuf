#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
workflow=${1:-$ROOT/.github/workflows/ci.yml}
patch_upgrade_smoke=$ROOT/tests/smoke/docker-patch-upgrade-smoke.sh
historical_upgrade_smoke=$ROOT/tests/smoke/docker-upgrade-smoke.sh
docker_smoke=$ROOT/tests/smoke/docker-smoke.sh
release_archive_smoke=$ROOT/tests/smoke/release-archive-smoke.sh
nextbufctl=$ROOT/nextbufctl
operations_runbook=$ROOT/docs/13-installation-operations-runbook.md
release_channel_adr=$ROOT/docs/adr/0020-stable-release-channels-and-lifecycle.md
acceptance_evidence_adr=$ROOT/docs/adr/0022-privacy-preserving-upgrade-acceptance-evidence.md
release_readiness=$ROOT/docs/19-v1.0.0-release-readiness.md
manual_acceptance=$ROOT/docs/21-v1.0.0-manual-acceptance.md
stable_pattern='^[1-9][0-9]*\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

fail() {
  printf '%s\n' "release channel policy smoke failed: $*" >&2
  exit 1
}

main_job=$(sed -n '/^  publish-main-image:/,/^  publish-release-image:/p' "$workflow")
image_job=$(sed -n '/^  image-smoke:/,/^  archive-build:/p' "$workflow")
upgrade_step=$(printf '%s\n' "$image_job" \
  | sed -n '/- name: Upgrade the current public release to the candidate/,/- name: Record the tested architecture image identity/p')
restore_gate=$(printf '%s\n' "$image_job" | sed -n '/RUN_RESTORE:/p')
fault_gate=$(printf '%s\n' "$image_job" | sed -n '/RUN_FAULTS:/p')
archive_job=$(sed -n '/^  archive-build:/,/^  publish-main-image:/p' "$workflow")
release_job=$(sed -n '/^  publish-release-image:/,/^  release-assets:/p' "$workflow")
assets_job=$(sed -n '/^  release-assets:/,/^  complete-release:/p' "$workflow")
completion_job=$(sed -n '/^  complete-release:/,/^  reconcile-stable:/p' "$workflow")
reconciliation_job=$(sed -n '/^  reconcile-stable:/,$p' "$workflow")
workflow_header=$(sed -n '1,/^jobs:/p' "$workflow")
check_job=$(sed -n '/^  check:/,/^  image-smoke:/p' "$workflow")

printf '%s\n' "$workflow_header" | grep -F -- 'release_rehearsal:' >/dev/null \
  || fail 'workflow dispatch must expose an explicit release rehearsal input'
printf '%s\n' "$workflow_header" \
  | grep -F -- 'Build and verify the release OCI index without writing a SemVer tag' >/dev/null \
  || fail 'the release rehearsal input must promise that it does not write SemVer'
printf '%s\n' "$check_job" | grep -F -- 'run: pnpm docs:check' >/dev/null \
  || fail 'CI must block broken documentation links'

printf '%s\n' "$workflow_header" | grep -F -- '${{ github.ref }}' >/dev/null \
  || fail 'workflow concurrency must remain ref-scoped so one tag cannot cancel another tag completion'

printf '%s\n' "$main_job" | grep -F -- '-t "$image:$immutable_tag"' >/dev/null \
  || fail 'main must publish an immutable sha-* manifest'
printf '%s\n' "$main_job" | grep -F -- '-t "$image:edge"' >/dev/null \
  || fail 'main must publish edge'
printf '%s\n' "$main_job" | grep -F -- 'different platform content' >/dev/null \
  || fail 'an existing sha-* manifest must match the tested platform images before edge reuse'
printf '%s\n' "$main_job" | grep -F -- 'tested-image-identity.mjs verify' >/dev/null \
  || fail 'main manifests must use the identities captured by architecture smoke tests'
printf '%s\n' "$main_job" | grep -F -- '"$image@$amd64_source"' >/dev/null \
  || fail 'main manifests must merge content-addressed tested source images'
printf '%s\n' "$main_job" | grep -F -- 'did not preserve tested source attestations' >/dev/null \
  || fail 'main manifests must preserve the exact tested source attestations'
printf '%s\n' "$main_job" | grep -F -- 'scripts/verify-oci-image-identity.sh' >/dev/null \
  || fail 'the immutable sha-* candidate must pass full OCI identity verification'
printf '%s\n' "$main_job" | grep -F -- 'scripts/inspect-registry-manifest.sh' >/dev/null \
  || fail 'main must distinguish an absent sha-* manifest from Registry failure'
if printf '%s\n' "$main_job" | grep -F -- '$image:latest' >/dev/null; then
  fail 'main must not publish latest'
fi
head_checks=$(printf '%s\n' "$main_job" | grep -Fc -- 'git/ref/heads/main')
[ "$head_checks" -ge 2 ] \
  || fail 'main must recheck the remote head immediately before moving edge'

printf '%s\n' "$upgrade_step" | grep -F -- "github.ref == 'refs/heads/main'" >/dev/null \
  || fail 'main must exercise the public-release-to-candidate upgrade gate'
printf '%s\n' "$upgrade_step" | grep -F -- "matrix.architecture == 'amd64'" >/dev/null \
  || fail 'the main upgrade gate must run once on amd64 rather than duplicate the destructive fixture'
printf '%s\n' "$upgrade_step" | grep -F -- 'steps.version.outputs.version != env.NEXTBUF_UPGRADE_BASELINE' >/dev/null \
  || fail 'the upgrade gate must skip candidates that equal the configured public baseline'
upgrade_baselines=$(grep -Fc -- 'NEXTBUF_UPGRADE_BASELINE: 1.0.1' "$workflow" || :)
[ "$upgrade_baselines" -eq 1 ] \
  || fail 'the v1.0.2 upgrade gate must use the released v1.0.1 baseline exactly once'
printf '%s\n' "$upgrade_step" | grep -F -- 'tests/smoke/docker-patch-upgrade-smoke.sh' >/dev/null \
  || fail 'the v1.0.2 workflow must run the no-migration patch upgrade smoke'
grep -F -- './nextbufctl upgrade "$TARGET_VERSION" --verify-objects' "$patch_upgrade_smoke" >/dev/null \
  || fail 'the upgrade gate must use the acceptance comparison and attachment object verification'
grep -F -- 'BASELINE_MIGRATION_COUNT=16' "$patch_upgrade_smoke" >/dev/null \
  || fail 'the patch upgrade must start from the complete stable migration set'
grep -F -- 'BASELINE_VERSION=${NEXTBUF_UPGRADE_BASELINE:-0.13.10}' "$historical_upgrade_smoke" >/dev/null \
  || fail 'the historical v0.13.10 migration-failure smoke must remain independently reproducible'
grep -F -- '#### 未公开 SemVer 候选的隔离 Registry' "$operations_runbook" >/dev/null \
  || fail 'the operations runbook must document pre-tag candidate staging'
grep -F -- 'registry:2.8.3' "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must use an explicit local Registry'
grep -F -- '-p 127.0.0.1:5510:5000' "$operations_runbook" >/dev/null \
  || fail 'the acceptance Registry must bind only to loopback'
grep -F -- 'docker buildx imagetools create' "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must copy complete OCI indexes'
grep -F -- '"$SOURCE_IMAGE@$expected_digest"' "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must copy candidates by immutable digest'
grep -F -- '"$(git rev-parse HEAD)" = "$CANDIDATE_COMMIT"' "$operations_runbook" >/dev/null \
  || fail 'candidate verification helpers must come from the frozen candidate commit'
grep -F -- 'copy_exact_index "$BASELINE_VERSION" "$BASELINE_INDEX_DIGEST"' \
  "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must stage the current baseline image'
grep -F -- 'copy_exact_index "$CANDIDATE_VERSION" "$CANDIDATE_INDEX_DIGEST"' \
  "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must stage the accepted candidate image'
grep -F -- 'NEXTBUF_IMAGE=127.0.0.1:5510/nextbuf' "$operations_runbook" >/dev/null \
  || fail 'the isolated instance must pull from the loopback Registry'
grep -F -- '"$local_actual" = "$expected_digest"' "$operations_runbook" >/dev/null \
  || fail 'the copied local index must retain the accepted digest'
grep -F -- 'sh scripts/verify-oci-image-identity.sh' "$operations_runbook" >/dev/null \
  || fail 'the copied candidate must pass complete OCI identity verification'
grep -F -- 'docker pull "$LOCAL_IMAGE:$BASELINE_VERSION"' "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must prove the baseline is pullable from the local Registry'
grep -F -- 'docker pull "$LOCAL_IMAGE:$CANDIDATE_VERSION"' "$operations_runbook" >/dev/null \
  || fail 'pre-tag acceptance must prove the candidate is pullable from the local Registry'
grep -F -- 'if (!value.config?.digest) process.exit(1)' "$operations_runbook" >/dev/null \
  || fail 'acceptance must resolve the current platform manifest config digest'
grep -F -- '"$LOCAL_CONFIG_ID" = "$CANDIDATE_CONFIG_DIGEST"' "$operations_runbook" >/dev/null \
  || fail 'the pulled candidate image config must match the platform manifest'
grep -F -- '"$running_config_id" = "$CANDIDATE_CONFIG_DIGEST"' "$operations_runbook" >/dev/null \
  || fail 'running Web and Worker must match the accepted platform image config'
for prerequisite in 'git --version' 'curl --version' 'node --version' \
  'docker buildx version' 'docker compose version'; do
  grep -F -- "$prerequisite" "$operations_runbook" >/dev/null \
    || fail "candidate acceptance must preflight $prerequisite"
done
grep -F -- 'Node 主版本为 24' "$operations_runbook" >/dev/null \
  || fail 'candidate acceptance must require Node.js 24'
for project_name in nextbuf-v1-fresh nextbuf-v1-production-copy nextbuf-v1-synthetic; do
  grep -F -- "COMPOSE_PROJECT_NAME=$project_name" "$operations_runbook" >/dev/null \
    || fail "acceptance must isolate the $project_name Compose project"
done
grep -F -- 'label=com.docker.compose.project=$COMPOSE_PROJECT_NAME' \
  "$operations_runbook" >/dev/null \
  || fail 'acceptance must verify project-scoped volume and network labels'
grep -F -- '独立 Docker daemon/主机' "$operations_runbook" >/dev/null \
  || fail 'the fixed-name BaoTa candidate must use an isolated Docker daemon'
grep -F -- '生产备份恢复副本只执行恢复、两段升级和真实既有事实核对' \
  "$release_readiness" >/dev/null \
  || fail 'the production recovery copy must remain read-only apart from recovery and upgrades'
grep -F -- '只在独立合成覆盖副本执行' "$release_readiness" >/dev/null \
  || fail 'destructive acceptance must remain confined to the synthetic copy'
grep -F -- 'backup --baota' "$nextbufctl" >/dev/null \
  || fail 'nextbufctl must retain the BaoTa production export entry point'
grep -F -- '--keep-stopped' "$nextbufctl" >/dev/null \
  || fail 'nextbufctl restore must retain the isolated keep-stopped mode'
grep -F -- './nextbufctl backup --baota "$PANEL_COMPOSE"' "$docker_smoke" >/dev/null \
  || fail 'deep Docker smoke must exercise the BaoTa export path'
grep -F -- '--restore-config --keep-stopped --yes' "$docker_smoke" >/dev/null \
  || fail 'deep Docker smoke must prove isolated restore remains stopped'
grep -F -- 'baota-checksum-failure.triggered' "$docker_smoke" >/dev/null \
  || fail 'deep Docker smoke must prove failed BaoTa exports restore the write processes'
grep -F -- 'baota-stop-signal.triggered' "$docker_smoke" >/dev/null \
  || fail 'deep Docker smoke must cover interruption during a BaoTa stop'
grep -F -- 'docker cp "$helper"' "$nextbufctl" >/dev/null \
  || fail 'BaoTa helper must avoid host UID-dependent bind mounts'
grep -F -- 'source_compose_snapshot="$temp/source-compose.baota.yml"' "$nextbufctl" >/dev/null \
  || fail 'BaoTa export must freeze the supplied Compose before validation'
grep -F -- 'docker compose -f "$source_compose_snapshot" config --format json' \
  "$nextbufctl" >/dev/null \
  || fail 'BaoTa evidence must be rendered from the archived Compose snapshot'
grep -F -- 'smoke.baota-transfer' "$docker_smoke" >/dev/null \
  || fail 'BaoTa transfer smoke must restore a unique PostgreSQL fact as well as attachments'
grep -F -- 'prepare-baota-backup.mjs' "$release_archive_smoke" >/dev/null \
  || fail 'the release archive must include the BaoTa export helper'
grep -F -- '#未公开-semver-候选的隔离-registry' "$manual_acceptance" >/dev/null \
  || fail 'manual acceptance must require the executable local Registry procedure'
grep -F -- '#未公开-semver-候选的隔离-registry' "$release_readiness" >/dev/null \
  || fail 'release readiness must require the executable local Registry procedure'
grep -F -- '#未公开-semver-候选的隔离-registry' "$release_channel_adr" >/dev/null \
  || fail 'the release channel ADR must preserve pre-tag candidate identity'
grep -F -- '#未公开-semver-候选的隔离-registry' "$acceptance_evidence_adr" >/dev/null \
  || fail 'the acceptance evidence ADR must preserve normal pull behavior'
grep -F -- '当前架构 manifest Digest' "$manual_acceptance" >/dev/null \
  || fail 'manual acceptance must distinguish the platform manifest from the OCI index'
grep -F -- '运行 image config ID' "$manual_acceptance" >/dev/null \
  || fail 'manual acceptance must bind the running container config identity'
grep -F -- 'RepoDigest 原样留证但不单独用来区分' "$manual_acceptance" >/dev/null \
  || fail 'manual acceptance must not conflate Docker RepoDigest with a platform manifest'
if grep -F -- '在隔离主机本地标记为 `NEXTBUF_IMAGE:1.0.0`' \
  "$operations_runbook" "$manual_acceptance" >/dev/null; then
  fail 'documentation must not prescribe a local tag that compose pull cannot resolve'
fi
for recovery_gate in "$restore_gate" "$fault_gate"; do
  [ -n "$recovery_gate" ] || fail 'recovery and fault gates must remain explicit'
  printf '%s\n' "$recovery_gate" | grep -F -- "matrix.architecture == 'amd64'" >/dev/null \
    || fail 'recovery and fault gates must remain limited to amd64'
  for deep_event in "startsWith(github.ref, 'refs/tags/v')" \
    "github.event_name == 'schedule'" "github.event_name == 'workflow_dispatch'"; do
    printf '%s\n' "$recovery_gate" | grep -F -- "$deep_event" >/dev/null \
      || fail 'recovery and fault gates must cover tags, schedules and manual runs'
  done
  if printf '%s\n' "$recovery_gate" | grep -F -- "github.ref == 'refs/heads/main'" >/dev/null \
    || printf '%s\n' "$recovery_gate" | grep -F -- "github.event_name == 'push'" >/dev/null; then
    fail 'daily main pushes must not run the full restore and fault-injection gates'
  fi
done

printf '%s\n' "$release_job" | grep -F -- '-t "$image:$version"' >/dev/null \
  || fail 'version tags must publish an immutable SemVer manifest'
printf '%s\n' "$release_job" \
  | grep -F -- 'if [[ "$GITHUB_EVENT_NAME" == push && "$GITHUB_REF" == refs/tags/v* ]]' >/dev/null \
  || fail 'only a tag push may enable immutable SemVer publication'
printf '%s\n' "$release_job" | grep -F -- 'if [[ "$publish_semver" != true ]]' >/dev/null \
  || fail 'release rehearsal must stop after staging verification'
printf '%s\n' "$release_job" | grep -F -- 'No SemVer or stable channel tag was written.' >/dev/null \
  || fail 'release rehearsal must explicitly report that no public tag was written'
printf '%s\n' "$release_job" | grep -F -- 'oci_index_digest=$index_digest' >/dev/null \
  || fail 'the SemVer job must export the tested OCI index digest'
printf '%s\n' "$release_job" | grep -F -- 'tested-image-identity.mjs verify' >/dev/null \
  || fail 'the SemVer job must consume persisted smoke-test identities'
printf '%s\n' "$release_job" | grep -F -- 'candidate_reference="$image:sha-${GITHUB_SHA}"' >/dev/null \
  || fail 'release publication must start from the accepted immutable sha-* candidate'
printf '%s\n' "$release_job" \
  | grep -F -- 'verify_release_index "$candidate_reference" "Accepted immutable candidate"' >/dev/null \
  || fail 'the accepted sha-* candidate must pass the complete release identity verifier'
printf '%s\n' "$release_job" | grep -F -- 'oci-platform-members.mjs --attestations' >/dev/null \
  || fail 'the SemVer manifest must verify attestation linkage before and after merging'
printf '%s\n' "$release_job" | grep -F -- 'did not preserve candidate attestations' >/dev/null \
  || fail 'the SemVer manifest must preserve candidate attestations exactly'
printf '%s\n' "$release_job" \
  | grep -F -- 'ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_SHA}-release-index' >/dev/null \
  || fail 'each release attempt must use a unique staging manifest tag'
printf '%s\n' "$release_job" | grep -F -- '-t "$staging_reference"' >/dev/null \
  || fail 'the accepted candidate must first be copied to a staging manifest'
printf '%s\n' "$release_job" | grep -F -- '"$image@$candidate_index_digest"' >/dev/null \
  || fail 'the staging manifest must be copied from the accepted candidate digest'
printf '%s\n' "$release_job" \
  | grep -F -- 'verify_release_index "$staging_reference"' >/dev/null \
  || fail 'the staging manifest must pass the complete release identity verification'
printf '%s\n' "$release_job" | grep -F -- 'scripts/verify-oci-image-identity.sh' >/dev/null \
  || fail 'the staging manifest must pass the full OCI identity and attestation verifier'
printf '%s\n' "$release_job" | grep -F -- '"$image@$staging_index_digest"' >/dev/null \
  || fail 'the immutable SemVer manifest must be created only from the verified staging digest'
printf '%s\n' "$release_job" \
  | grep -F -- 'does not match verified staged release index' >/dev/null \
  || fail 'the final SemVer index digest must equal the verified staging index digest'
printf '%s\n' "$release_job" \
  | grep -F -- 'Staged release manifest does not match accepted candidate' >/dev/null \
  || fail 'the staged release digest must equal the manually accepted sha-* candidate'
staging_create_line=$(printf '%s\n' "$release_job" | grep -nF -- '-t "$staging_reference"' \
  | head -n 1 | cut -d: -f1)
candidate_verify_line=$(printf '%s\n' "$release_job" \
  | grep -nF -- 'verify_release_index "$candidate_reference"' | head -n 1 | cut -d: -f1)
staging_verify_line=$(printf '%s\n' "$release_job" \
  | grep -nF -- 'verify_release_index "$staging_reference"' | head -n 1 | cut -d: -f1)
release_create_line=$(printf '%s\n' "$release_job" | grep -nF -- '-t "$image:$version"' \
  | head -n 1 | cut -d: -f1)
release_body_preflight_line=$(printf '%s\n' "$release_job" \
  | grep -nF -- 'node scripts/prepare-github-release-body.mjs' | head -n 1 | cut -d: -f1)
[ -n "$candidate_verify_line" ] && [ -n "$staging_create_line" ] && [ -n "$staging_verify_line" ] \
  && [ -n "$release_body_preflight_line" ] && [ -n "$release_create_line" ] \
  && [ "$candidate_verify_line" -lt "$staging_create_line" ] \
  && [ "$staging_create_line" -lt "$staging_verify_line" ] \
  && [ "$staging_verify_line" -lt "$release_body_preflight_line" ] \
  && [ "$release_body_preflight_line" -lt "$release_create_line" ] \
  || fail 'staging and the real Release body/assets must be verified before any immutable SemVer write'
if printf '%s\n' "$release_job" | grep -F -- '$image:latest' >/dev/null; then
  fail 'the immutable SemVer job must not move latest before Release assets succeed'
fi

printf '%s\n' "$completion_job" | grep -F -- 'needs: release-assets' >/dev/null \
  || fail 'each tag must complete its Release after publishing all assets'
printf '%s\n' "$reconciliation_job" | grep -F -- 'needs: complete-release' >/dev/null \
  || fail 'stable reconciliation must wait for this tag completion attempt'
printf '%s\n' "$reconciliation_job" | grep -F -- 'test("^v[1-9][0-9]*' >/dev/null \
  || fail 'stable releases must exclude v0 and prerelease versions'
printf '%s\n' "$reconciliation_job" | grep -F -- '-t "$image:latest"' >/dev/null \
  || fail 'the newest stable release must update latest'
printf '%s\n' "$reconciliation_job" | grep -F -- '"$image@$index_digest"' >/dev/null \
  || fail 'latest must be promoted from the receipt-bound OCI digest rather than a mutable tag'
printf '%s\n' "$reconciliation_job" | grep -F -- 'highest_stable' >/dev/null \
  || fail 'every surviving coordinator must reconcile the highest complete stable Release'
printf '%s\n' "$reconciliation_job" | grep -F -- 'repos/${GITHUB_REPOSITORY}/releases?per_page=100' >/dev/null \
  || fail 'latest must be selected from completed releases rather than bare tags'
if printf '%s\n' "$completion_job" | grep -E -- '^[[:space:]]+concurrency:' >/dev/null; then
  fail 'per-tag Release completion must not enter a replaceable job-level concurrency group'
fi
printf '%s\n' "$reconciliation_job" | grep -F -- 'group: nextbuf-stable-latest' >/dev/null \
  || fail 'only stable reconciliation must use the cross-tag lock'
printf '%s\n' "$reconciliation_job" | grep -F -- 'cancel-in-progress: false' >/dev/null \
  || fail 'a running stable reconciliation must finish before another coordinator starts'
stable_locks=$(grep -Fc -- 'group: nextbuf-stable-latest' "$workflow" || :)
[ "$stable_locks" -eq 1 ] \
  || fail 'the replaceable cross-tag lock must occur only on stable reconciliation'
if printf '%s\n' "$completion_job" | grep -F -- '$image:latest' >/dev/null; then
  fail 'per-tag Release completion must not write the shared stable channel'
fi

printf '%s\n' "$image_job" | grep -F -- 'Resolve the tested architecture image identity' >/dev/null \
  || fail 'each architecture digest must be frozen before content-addressed smoke tests'
printf '%s\n' "$image_job" | grep -F -- 'candidate="sha-${GITHUB_SHA}"' >/dev/null \
  || fail 'main, rehearsal and tag runs must reuse one commit-addressed architecture candidate'
printf '%s\n' "$image_job" | grep -F -- 'REQUIRE_FROZEN_CANDIDATE:' >/dev/null \
  || fail 'release runs must require the architecture candidates accepted on main'
printf '%s\n' "$image_job" \
  | grep -F -- 'release runs never rebuild it' >/dev/null \
  || fail 'a missing accepted release candidate must fail instead of rebuilding'
attestation_gate=$(printf '%s\n' "$image_job" | sed -n '/GENERATE_RELEASE_ATTESTATIONS:/p')
printf '%s\n' "$attestation_gate" | grep -F -- "github.event_name == 'push'" >/dev/null \
  || fail 'main candidates must include the attestations later promoted by the release'
printf '%s\n' "$image_job" | grep -F -- 'source_digest=$source_digest' >/dev/null \
  || fail 'each tested identity must retain the immutable top-level source digest'
printf '%s\n' "$image_job" | grep -F -- 'outputs.runtime_digest' >/dev/null \
  || fail 'architecture smoke tests must pull the frozen runtime digest'
printf '%s\n' "$image_job" | grep -F -- 'nextbuf-tested-image-${{ github.run_id }}-${{ matrix.architecture }}' >/dev/null \
  || fail 'tested architecture identities must cross the matrix job boundary as artifacts'
printf '%s\n' "$image_job" | grep -F -- 'overwrite: true' >/dev/null \
  || fail 'tested architecture identity artifacts must support complete workflow reruns'

if printf '%s\n' "$image_job" | grep -Fq 'GITHUB_RUN_ATTEMPT'; then
  fail 'candidate architecture tags must survive failed-job reruns'
fi
printf '%s\n' "$archive_job" | grep -F -- 'overwrite: true' >/dev/null \
  || fail 'release artifacts must support a complete workflow rerun'
printf '%s\n' "$archive_job" \
  | grep -F -- 'artifact_name="nextbuf-release-rehearsal-$GITHUB_RUN_ID"' >/dev/null \
  || fail 'release rehearsal must retain its archive evidence under a run-scoped artifact name'
archive_rehearsal_conditions=$(printf '%s\n' "$archive_job" \
  | grep -Fc -- "github.event_name == 'workflow_dispatch' && inputs.release_rehearsal")
[ "$archive_rehearsal_conditions" -ge 3 ] \
  || fail 'release rehearsal must build, SBOM and upload the verified standalone archive'
retention_count=$(grep -Ec '^[[:space:]]+retention-days:' "$workflow" || :)
[ "$retention_count" -ge 2 ] \
  || fail 'tested identities and release files must declare an artifact retention period'
if grep -E '^[[:space:]]+retention-days:' "$workflow" \
  | grep -Fv -- 'retention-days: 14' >/dev/null; then
  fail 'all release evidence artifacts must be retained for 14 days'
fi
grep -Fq 'Reuse a candidate from an earlier workflow attempt' "$workflow" \
  || fail 'main, rehearsal and tag runs must reuse already pushed architecture candidates'
printf '%s\n' "$release_job" | grep -F -- 'Reusing the matching immutable release manifest' >/dev/null \
  || fail 'a matching SemVer manifest must be reusable after a downstream release failure'
printf '%s\n' "$release_job" | grep -F -- 'oci-platform-members.mjs' >/dev/null \
  || fail 'SemVer reruns must compare exact runtime and attestation members'
printf '%s\n' "$release_job" | grep -F -- 'scripts/inspect-registry-manifest.sh' >/dev/null \
  || fail 'SemVer creation must distinguish an absent manifest from Registry failure'
printf '%s\n' "$reconciliation_job" | grep -F -- 'linux-x64.tar.gz.sha256' >/dev/null \
  || fail 'latest selection must ignore releases without the required archive assets'
printf '%s\n' "$reconciliation_job" | grep -F -- 'sbom.spdx.json' >/dev/null \
  || fail 'latest selection must ignore releases without the required SBOM asset'
printf '%s\n' "$completion_job" | grep -F -- 'Publish a fresh completion receipt' >/dev/null \
  || fail 'each tag must publish its completion receipt before shared reconciliation'
if printf '%s\n' "$reconciliation_job" | grep -F -- 'Publish a fresh completion receipt' >/dev/null; then
  fail 'the replaceable reconciliation job must not own per-tag completion receipts'
fi
if printf '%s\n' "$reconciliation_job" | grep -F -- 'gh release upload' >/dev/null; then
  fail 'stable reconciliation must not upload per-tag Release assets or receipts'
fi
if printf '%s\n' "$reconciliation_job" | grep -F -- 'delete-github-release-asset.sh' >/dev/null; then
  fail 'stable reconciliation must not clean up a per-tag completion receipt'
fi
printf '%s\n' "$completion_job" | grep -F -- 'oci_index_digest=%s' >/dev/null \
  || fail 'the completion receipt must bind the tested OCI index digest'
printf '%s\n' "$completion_job" | grep -F -- 'oci_linux_amd64_digest=%s' >/dev/null \
  || fail 'the completion receipt must bind the tested amd64 digest'
printf '%s\n' "$completion_job" | grep -F -- 'oci_linux_arm64_digest=%s' >/dev/null \
  || fail 'the completion receipt must bind the tested arm64 digest'
printf '%s\n' "$completion_job" | grep -F -- 'Synchronize the expected GitHub Release body' >/dev/null \
  || fail 'completion must regenerate and synchronize the expected Release body'
printf '%s\n' "$completion_job" | grep -F -- '--notes-file release/release-body.md' >/dev/null \
  || fail 'completion must update the remote Release from the validated body file'
printf '%s\n' "$completion_job" | grep -F -- 'release_body_sha256=%s' >/dev/null \
  || fail 'the completion receipt must bind the exact GitHub Release body'
body_sync_line=$(printf '%s\n' "$completion_job" \
  | grep -nF -- 'Synchronize the expected GitHub Release body' | head -n 1 | cut -d: -f1)
receipt_inspection_line=$(printf '%s\n' "$completion_job" \
  | grep -nF -- 'Inspect this Release completion receipt' | head -n 1 | cut -d: -f1)
[ -n "$body_sync_line" ] && [ -n "$receipt_inspection_line" ] \
  && [ "$body_sync_line" -lt "$receipt_inspection_line" ] \
  || fail 'the expected Release body must be synchronized before any receipt is reused'
printf '%s\n' "$completion_job" | grep -F -- 'Verify an existing completion receipt' >/dev/null \
  || fail 'an existing completion receipt must be verified before Release reuse'
completion_receipt_verifications=$(printf '%s\n' "$completion_job" \
  | grep -Fc -- 'scripts/verify-github-release.sh')
[ "$completion_receipt_verifications" -ge 2 ] \
  || fail 'the current tag Release must be verified before reuse and after completion'
reconciliation_receipt_verifications=$(printf '%s\n' "$reconciliation_job" \
  | grep -Fc -- 'scripts/verify-github-release.sh')
[ "$reconciliation_receipt_verifications" -ge 2 ] \
  || fail 'the globally selected Release must be verified before latest changes'
printf '%s\n' "$completion_job" | grep -F -- 'scripts/verify-github-tag-commit.sh' >/dev/null \
  || fail 'the final tag commit must be checked before a completion receipt is uploaded'
printf '%s\n' "$completion_job" | grep -F -- 'Remove an unverified fresh completion receipt' >/dev/null \
  || fail 'a failed remote verification must remove the completion receipt'
printf '%s\n' "$completion_job" | grep -F -- "steps.receipt-upload.outputs.uploaded == 'true'" >/dev/null \
  || fail 'cleanup must never delete a completion receipt this workflow did not upload'
printf '%s\n' "$completion_job" | grep -F -- 'delete-github-release-asset.sh' >/dev/null \
  || fail 'invalid and unverified receipts must use retrying explicit cleanup'
printf '%s\n' "$reconciliation_job" | grep -F -- 'release-complete.txt' >/dev/null \
  || fail 'latest selection must require the release completion receipt'
printf '%s\n' "$reconciliation_job" | grep -F -- 'scripts/verify-github-release.sh' >/dev/null \
  || fail 'the completion receipt, tag commit and asset hashes must be verified before latest moves'
printf '%s\n' "$reconciliation_job" | grep -F -- 'scripts/assess-stable-image-channel.sh' >/dev/null \
  || fail 'latest promotion must validate the current Registry channel state'
reconciliation_channel_checks=$(printf '%s\n' "$reconciliation_job" \
  | grep -Fc -- 'scripts/assess-stable-image-channel.sh')
[ "$reconciliation_channel_checks" -ge 2 ] \
  || fail 'latest promotion must recheck the Registry channel immediately before promotion'
completion_oci_identity_checks=$(printf '%s\n' "$completion_job" \
  | grep -Fc -- 'scripts/verify-oci-image-identity.sh')
[ "$completion_oci_identity_checks" -ge 3 ] \
  || fail 'the tag OCI identity must be checked before receipt reuse, creation and completion'
reconciliation_oci_identity_checks=$(printf '%s\n' "$reconciliation_job" \
  | grep -Fc -- 'scripts/verify-oci-image-identity.sh')
[ "$reconciliation_oci_identity_checks" -ge 4 ] \
  || fail 'SemVer and latest OCI identities must be rechecked before and after promotion'
printf '%s\n' "$reconciliation_job" | grep -F -- 'refusing rollback' >/dev/null \
  || fail 'latest promotion must refuse a candidate older than the current image channel'
highest_checks=$(printf '%s\n' "$reconciliation_job" | grep -Fc -- 'highest_stable)')
[ "$highest_checks" -ge 2 ] \
  || fail 'the highest completed Release must be rechecked immediately before promotion'

printf '%s\n' "$assets_job" | grep -F -- 'steps.release-channel.outputs.prerelease' >/dev/null \
  || fail 'GitHub Release prerelease state must use the same stable classification'
printf '%s\n' "$assets_job" \
  | grep -F -- "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')" >/dev/null \
  || fail 'workflow dispatch rehearsal must never create or update a GitHub Release'
printf '%s\n' "$assets_job" | grep -F -- "$stable_pattern" >/dev/null \
  || fail 'GitHub Release classification must exclude v0, invalid and prerelease versions'
printf '%s\n' "$assets_job" | grep -F -- 'Prepare validated GitHub Release body' >/dev/null \
  || fail 'GitHub Releases must use the validated project release notes'
printf '%s\n' "$assets_job" \
  | grep -F -- 'node scripts/prepare-github-release-body.mjs' >/dev/null \
  || fail 'GitHub Releases must execute the tested Release body generator'
printf '%s\n' "$assets_job" | grep -F -- 'body_path: release/release-body.md' >/dev/null \
  || fail 'GitHub Releases must publish the validated release body'
for release_evidence in 'OCI_INDEX_DIGEST' 'OCI_AMD64_DIGEST' 'OCI_ARM64_DIGEST'; do
  printf '%s\n' "$assets_job" | grep -F -- "$release_evidence" >/dev/null \
    || fail "the release body must include dynamic evidence from $release_evidence"
done
if printf '%s\n' "$assets_job" | grep -F -- 'generate_release_notes: true' >/dev/null; then
  fail 'GitHub-generated notes must not replace the validated project release notes'
fi

if grep -Eq '^\s*uses: [^ ]+@v[0-9]' "$workflow"; then
  fail 'third-party Actions must be pinned to full commit SHAs'
fi
if grep -E '^[[:space:]]*uses:' "$workflow" \
  | grep -Ev '@[0-9a-f]{40}([[:space:]]|$)' >/dev/null; then
  fail 'every external Action reference must use a full commit SHA'
fi

for version in 1.0.0 1.0.10 2.4.0; do
  printf '%s\n' "$version" | grep -Eq "$stable_pattern" \
    || fail "$version must be classified as stable"
done
for version in 0.13.10 1.0.0-rc.1 1.01.0 1.0.01 1.0.0+build.1; do
  if printf '%s\n' "$version" | grep -Eq "$stable_pattern"; then
    fail "$version must not be classified as stable"
  fi
done

printf '%s\n' 'release channel policy smoke passed'
