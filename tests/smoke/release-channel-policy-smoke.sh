#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
workflow=${1:-$ROOT/.github/workflows/ci.yml}
upgrade_smoke=$ROOT/tests/smoke/docker-upgrade-smoke.sh
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
printf '%s\n' "$main_job" | grep -F -- 'did not preserve tested source descriptors' >/dev/null \
  || fail 'main manifests must preserve the exact tested source descriptors'
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
grep -F -- './nextbufctl upgrade "$TARGET_VERSION" --verify-objects' "$upgrade_smoke" >/dev/null \
  || fail 'the upgrade gate must use the acceptance comparison and attachment object verification'
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
printf '%s\n' "$release_job" | grep -F -- 'oci_index_digest=$index_digest' >/dev/null \
  || fail 'the SemVer job must export the tested OCI index digest'
printf '%s\n' "$release_job" | grep -F -- 'tested-image-identity.mjs verify' >/dev/null \
  || fail 'the SemVer job must consume persisted smoke-test identities'
printf '%s\n' "$release_job" | grep -F -- '"$image@$amd64_source"' >/dev/null \
  || fail 'the SemVer manifest must merge content-addressed tested source images'
printf '%s\n' "$release_job" | grep -F -- 'oci-platform-members.mjs --attestations' >/dev/null \
  || fail 'the SemVer manifest must verify attestation linkage before and after merging'
printf '%s\n' "$release_job" | grep -F -- 'did not preserve candidate attestations' >/dev/null \
  || fail 'the SemVer manifest must preserve candidate attestations exactly'
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
printf '%s\n' "$image_job" | grep -F -- 'source_digest=$source_digest' >/dev/null \
  || fail 'each tested identity must retain the immutable top-level source digest'
printf '%s\n' "$image_job" | grep -F -- 'outputs.runtime_digest' >/dev/null \
  || fail 'architecture smoke tests must pull the frozen runtime digest'
printf '%s\n' "$image_job" | grep -F -- 'nextbuf-tested-image-${{ github.run_id }}-${{ matrix.architecture }}' >/dev/null \
  || fail 'tested architecture identities must cross the matrix job boundary as artifacts'
printf '%s\n' "$image_job" | grep -F -- 'overwrite: true' >/dev/null \
  || fail 'tested architecture identity artifacts must support complete workflow reruns'

if grep -Fq 'GITHUB_RUN_ATTEMPT' "$workflow"; then
  fail 'candidate architecture tags must survive failed-job reruns'
fi
printf '%s\n' "$archive_job" | grep -F -- 'overwrite: true' >/dev/null \
  || fail 'release artifacts must support a complete workflow rerun'
grep -Fq 'Reuse a candidate from an earlier workflow attempt' "$workflow" \
  || fail 'reruns must reuse already pushed architecture candidates'
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
printf '%s\n' "$assets_job" | grep -F -- "$stable_pattern" >/dev/null \
  || fail 'GitHub Release classification must exclude v0, invalid and prerelease versions'

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
