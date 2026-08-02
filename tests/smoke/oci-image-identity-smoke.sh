#!/bin/sh
set -eu

fail() {
  printf '%s\n' "OCI image identity smoke failed: $*" >&2
  exit 1
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
mkdir -p "$work_dir/bin"

cat > "$work_dir/bin/docker" <<'EOF'
#!/bin/sh
set -eu

if [ "${1:-} ${2:-} ${3:-}" != 'buildx imagetools inspect' ]; then
  printf '%s\n' "unexpected fake Docker invocation: $*" >&2
  exit 2
fi
if [ "${5:-}" = '--format' ]; then
  printf '%s\n' \
    "${FAKE_INDEX_DIGEST:-sha256:1111111111111111111111111111111111111111111111111111111111111111}"
  exit 0
fi
if [ "${5:-}" = '--raw' ]; then
  extra=''
  if [ "${FAKE_EXTRA_PLATFORM:-0}" = 1 ]; then
    extra=',{"digest":"sha256:4444444444444444444444444444444444444444444444444444444444444444","platform":{"os":"linux","architecture":"s390x"}}'
  fi
  printf '%s\n' \
    "{\"manifests\":[{\"digest\":\"${FAKE_AMD64_DIGEST:-sha256:2222222222222222222222222222222222222222222222222222222222222222}\",\"platform\":{\"os\":\"linux\",\"architecture\":\"amd64\"}},{\"digest\":\"${FAKE_ARM64_DIGEST:-sha256:3333333333333333333333333333333333333333333333333333333333333333}\",\"platform\":{\"os\":\"linux\",\"architecture\":\"arm64\"}}$extra]}"
  if [ "${FAKE_RAW_EXIT_FAILURE:-0}" = 1 ]; then exit 1; fi
  exit 0
fi

printf '%s\n' "unexpected fake Docker invocation: $*" >&2
exit 2
EOF
chmod +x "$work_dir/bin/docker"
PATH="$work_dir/bin:$PATH"
export PATH

index=sha256:1111111111111111111111111111111111111111111111111111111111111111
amd64=sha256:2222222222222222222222222222222222222222222222222222222222222222
arm64=sha256:3333333333333333333333333333333333333333333333333333333333333333

sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
  "$index" "$amd64" "$arm64" >/dev/null

if sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
  sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  "$amd64" "$arm64" >/dev/null 2>&1; then
  fail 'an unexpected OCI index digest was accepted'
fi

FAKE_AMD64_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export FAKE_AMD64_DIGEST
if sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
  "$index" "$amd64" "$arm64" >/dev/null 2>&1; then
  fail 'an unexpected platform digest was accepted'
fi
unset FAKE_AMD64_DIGEST

FAKE_RAW_EXIT_FAILURE=1
export FAKE_RAW_EXIT_FAILURE
if sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
  "$index" "$amd64" "$arm64" >/dev/null 2>&1; then
  fail 'a failed Registry response with parseable OCI output was accepted'
fi
FAKE_RAW_EXIT_FAILURE=0
export FAKE_RAW_EXIT_FAILURE

FAKE_EXTRA_PLATFORM=1
export FAKE_EXTRA_PLATFORM
if sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
  "$index" "$amd64" "$arm64" >/dev/null 2>&1; then
  fail 'an unexpected extra runtime platform was accepted'
fi

runtime=sha256:5555555555555555555555555555555555555555555555555555555555555555
attestation=sha256:6666666666666666666666666666666666666666666666666666666666666666
index_json=$(printf '%s\n' \
  "{\"manifests\":[{\"digest\":\"$runtime\",\"platform\":{\"os\":\"linux\",\"architecture\":\"amd64\"}},{\"digest\":\"$attestation\",\"platform\":{\"os\":\"unknown\",\"architecture\":\"unknown\"},\"annotations\":{\"vnd.docker.reference.type\":\"attestation-manifest\",\"vnd.docker.reference.digest\":\"$runtime\"}}]}")
platforms=$(printf '%s\n' "$index_json" \
  | node "$root/scripts/oci-platform-members.mjs")
[ "$platforms" = "linux/amd64=$runtime" ] \
  || fail 'runtime platform parsing changed'
descriptors=$(printf '%s\n' "$index_json" \
  | node "$root/scripts/oci-platform-members.mjs" --descriptors)
[ "$descriptors" = "$(printf '%s\n' "$runtime" "$attestation" | sort)" ] \
  || fail 'OCI descriptor parsing did not preserve attestations'
attestations=$(printf '%s\n' "$index_json" \
  | node "$root/scripts/oci-platform-members.mjs" --attestations)
[ "$attestations" = "$runtime=$attestation" ] \
  || fail 'OCI attestation linkage was not preserved'

printf '%s\n' 'OCI image identity smoke passed'
