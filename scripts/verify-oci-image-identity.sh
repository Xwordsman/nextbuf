#!/bin/sh
set -eu

reference=${1:-}
expected_index_digest=${2:-}
expected_amd64_digest=${3:-}
expected_arm64_digest=${4:-}

if [ -z "$reference" ] || [ -z "$expected_index_digest" ] \
  || [ -z "$expected_amd64_digest" ] || [ -z "$expected_arm64_digest" ]; then
  printf '%s\n' \
    'Usage: scripts/verify-oci-image-identity.sh <reference> <index-digest> <amd64-digest> <arm64-digest>' >&2
  exit 2
fi

for digest in "$expected_index_digest" "$expected_amd64_digest" "$expected_arm64_digest"; do
  if ! printf '%s\n' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
    printf '%s\n' "Invalid expected OCI digest: $digest" >&2
    exit 2
  fi
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work_dir=$(mktemp -d)
raw_manifest="$work_dir/index.json"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
actual_index_digest=$(docker buildx imagetools inspect "$reference" \
  --format '{{.Manifest.Digest}}')
if ! docker buildx imagetools inspect "$reference" --raw >"$raw_manifest"; then
  printf '%s\n' "OCI manifest inspection failed for $reference" >&2
  exit 1
fi
actual_members=$(node "$script_dir/oci-platform-members.mjs" <"$raw_manifest")
expected_members=$(printf '%s\n' \
  "linux/amd64=$expected_amd64_digest" \
  "linux/arm64=$expected_arm64_digest" \
  | sort)

if [ "$actual_index_digest" != "$expected_index_digest" ]; then
  printf '%s\n' \
    "OCI index digest mismatch for $reference: expected $expected_index_digest, got $actual_index_digest" >&2
  exit 1
fi
if [ "$actual_members" != "$expected_members" ]; then
  printf '%s\n' "OCI platform members do not match the release receipt for $reference" >&2
  exit 1
fi

actual_attestations=$(node "$script_dir/oci-platform-members.mjs" --attestations <"$raw_manifest")
actual_subjects=$(printf '%s\n' "$actual_attestations" | awk -F= 'NF == 2 { print $1 }' | sort)
expected_subjects=$(printf '%s\n' "$expected_amd64_digest" "$expected_arm64_digest" | sort)
if [ "$actual_subjects" != "$expected_subjects" ]; then
  printf '%s\n' \
    "OCI attestations do not identify exactly the release platform manifests for $reference" >&2
  exit 1
fi
attestation_digest_count=$(printf '%s\n' "$actual_attestations" \
  | awk -F= 'NF == 2 { print $2 }' | sort -u | awk 'NF { count += 1 } END { print count + 0 }')
if [ "$attestation_digest_count" -ne 2 ]; then
  printf '%s\n' \
    "OCI release platforms do not have distinct attestation manifests for $reference" >&2
  exit 1
fi

case "$reference" in
  *@sha256:*) repository=${reference%@sha256:*} ;;
  *)
    repository_prefix=${reference%/*}
    repository_name=${reference##*/}
    case "$repository_name" in *:*) repository_name=${repository_name%%:*} ;; esac
    if [ "$repository_prefix" = "$reference" ]; then
      repository=$repository_name
    else
      repository="$repository_prefix/$repository_name"
    fi
    ;;
esac

attestation_number=0
while IFS='=' read -r subject_digest attestation_digest; do
  [ -n "$subject_digest" ] || continue
  attestation_number=$((attestation_number + 1))
  attestation_manifest="$work_dir/attestation-$attestation_number.json"
  attestation_reference="$repository@$attestation_digest"
  if ! docker buildx imagetools inspect "$attestation_reference" --raw \
    >"$attestation_manifest"; then
    printf '%s\n' "OCI attestation inspection failed for $attestation_reference" >&2
    exit 1
  fi
  if ! node "$script_dir/verify-oci-attestation-manifest.mjs" \
    <"$attestation_manifest" >/dev/null; then
    printf '%s\n' \
      "OCI attestation predicates are incomplete for subject $subject_digest in $reference" >&2
    exit 1
  fi
done <<EOF
$actual_attestations
EOF

printf '%s\n' "Verified OCI image identity for $reference at $expected_index_digest"
