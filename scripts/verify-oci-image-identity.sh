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
raw_manifest=$(mktemp)
trap 'rm -f "$raw_manifest"' EXIT HUP INT TERM
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

printf '%s\n' "Verified OCI image identity for $reference at $expected_index_digest"
