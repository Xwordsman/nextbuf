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

reference=${4:-}
option=${5:-}
amd64=${FAKE_AMD64_DIGEST:-sha256:2222222222222222222222222222222222222222222222222222222222222222}
arm64=${FAKE_ARM64_DIGEST:-sha256:3333333333333333333333333333333333333333333333333333333333333333}
amd64_attestation=sha256:5555555555555555555555555555555555555555555555555555555555555555
arm64_attestation=sha256:6666666666666666666666666666666666666666666666666666666666666666

if [ "$option" = '--format' ]; then
  printf '%s\n' \
    "${FAKE_INDEX_DIGEST:-sha256:1111111111111111111111111111111111111111111111111111111111111111}"
  exit 0
fi

if [ "$option" != '--raw' ]; then
  printf '%s\n' "unexpected fake Docker invocation: $*" >&2
  exit 2
fi

case "$reference" in
  *"@$amd64_attestation"|*"@$arm64_attestation")
    layers=''
    if [ "${FAKE_MISSING_SBOM:-0}" != 1 ]; then
      layers='{"mediaType":"application/vnd.in-toto+json","digest":"sha256:7777777777777777777777777777777777777777777777777777777777777777","size":123,"annotations":{"in-toto.io/predicate-type":"https://spdx.dev/Document"}}'
    fi
    if [ "${FAKE_MISSING_PROVENANCE:-0}" != 1 ]; then
      provenance='{"mediaType":"application/vnd.in-toto+json","digest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","size":123,"annotations":{"in-toto.io/predicate-type":"https://slsa.dev/provenance/v1"}}'
      if [ -n "$layers" ]; then layers="$layers,$provenance"; else layers=$provenance; fi
    fi
    printf '%s\n' "{\"schemaVersion\":2,\"layers\":[$layers]}"
    ;;
  *)
    extra=''
    if [ "${FAKE_EXTRA_PLATFORM:-0}" = 1 ]; then
      extra=',{"digest":"sha256:4444444444444444444444444444444444444444444444444444444444444444","platform":{"os":"linux","architecture":"s390x"}}'
    fi
    amd64_subject=$amd64
    if [ "${FAKE_WRONG_SUBJECT:-0}" = 1 ]; then
      amd64_subject=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    fi
    printf '%s\n' \
      "{\"manifests\":[{\"digest\":\"$amd64\",\"platform\":{\"os\":\"linux\",\"architecture\":\"amd64\"}},{\"digest\":\"$amd64_attestation\",\"platform\":{\"os\":\"unknown\",\"architecture\":\"unknown\"},\"annotations\":{\"vnd.docker.reference.type\":\"attestation-manifest\",\"vnd.docker.reference.digest\":\"$amd64_subject\"}},{\"digest\":\"$arm64\",\"platform\":{\"os\":\"linux\",\"architecture\":\"arm64\"}},{\"digest\":\"$arm64_attestation\",\"platform\":{\"os\":\"unknown\",\"architecture\":\"unknown\"},\"annotations\":{\"vnd.docker.reference.type\":\"attestation-manifest\",\"vnd.docker.reference.digest\":\"$arm64\"}}$extra]}"
    if [ "${FAKE_RAW_EXIT_FAILURE:-0}" = 1 ]; then exit 1; fi
    ;;
esac
EOF
chmod +x "$work_dir/bin/docker"
PATH="$work_dir/bin:$PATH"
export PATH

index=sha256:1111111111111111111111111111111111111111111111111111111111111111
amd64=sha256:2222222222222222222222222222222222222222222222222222222222222222
arm64=sha256:3333333333333333333333333333333333333333333333333333333333333333

verify() {
  sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
    "$index" "$amd64" "$arm64"
}

verify >/dev/null

if sh "$root/scripts/verify-oci-image-identity.sh" example.invalid/app:1.0.0 \
  sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  "$amd64" "$arm64" >/dev/null 2>&1; then
  fail 'an unexpected OCI index digest was accepted'
fi

FAKE_AMD64_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export FAKE_AMD64_DIGEST
if verify >/dev/null 2>&1; then
  fail 'an unexpected platform digest was accepted'
fi
unset FAKE_AMD64_DIGEST

FAKE_RAW_EXIT_FAILURE=1
export FAKE_RAW_EXIT_FAILURE
if verify >/dev/null 2>&1; then
  fail 'a failed Registry response with parseable OCI output was accepted'
fi
unset FAKE_RAW_EXIT_FAILURE

FAKE_EXTRA_PLATFORM=1
export FAKE_EXTRA_PLATFORM
if verify >/dev/null 2>&1; then
  fail 'an unexpected extra runtime platform was accepted'
fi
unset FAKE_EXTRA_PLATFORM

FAKE_MISSING_SBOM=1
export FAKE_MISSING_SBOM
if verify >/dev/null 2>&1; then
  fail 'an attestation manifest without an SPDX SBOM was accepted'
fi
unset FAKE_MISSING_SBOM

FAKE_MISSING_PROVENANCE=1
export FAKE_MISSING_PROVENANCE
if verify >/dev/null 2>&1; then
  fail 'an attestation manifest without SLSA provenance was accepted'
fi
unset FAKE_MISSING_PROVENANCE

FAKE_WRONG_SUBJECT=1
export FAKE_WRONG_SUBJECT
if verify >/dev/null 2>&1; then
  fail 'an attestation linked to the wrong runtime subject was accepted'
fi
unset FAKE_WRONG_SUBJECT

runtime=sha256:9999999999999999999999999999999999999999999999999999999999999999
attestation=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
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
