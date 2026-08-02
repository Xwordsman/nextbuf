#!/bin/sh
set -eu

fail() {
  printf '%s\n' "release receipt smoke failed: $*" >&2
  exit 1
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

tag=v1.0.0
version=1.0.0
commit=0123456789abcdef0123456789abcdef01234567
archive="nextbuf-$version-linux-x64.tar.gz"
checksum="$archive.sha256"
sbom="nextbuf-$tag-sbom.spdx.json"
receipt="nextbuf-$tag-release-complete.txt"
oci_image=ghcr.io/xwordsman/nextbuf
oci_index=sha256:1111111111111111111111111111111111111111111111111111111111111111
oci_amd64=sha256:2222222222222222222222222222222222222222222222222222222222222222
oci_arm64=sha256:3333333333333333333333333333333333333333333333333333333333333333

printf '%s\n' 'archive fixture' > "$work_dir/$archive"
printf '%s\n' '{"spdxVersion":"SPDX-2.3"}' > "$work_dir/$sbom"
(cd "$work_dir" && sha256sum --text -- "$archive" > "$checksum")
{
  printf 'version=%s\n' "$version"
  printf 'commit=%s\n' "$commit"
  printf 'oci_image=%s\n' "$oci_image"
  printf 'oci_index_digest=%s\n' "$oci_index"
  printf 'oci_linux_amd64_digest=%s\n' "$oci_amd64"
  printf 'oci_linux_arm64_digest=%s\n' "$oci_arm64"
  (cd "$work_dir" && sha256sum --text -- "$archive" "$checksum" "$sbom" | sort)
} > "$work_dir/$receipt"

verify_receipt() {
  node "$root/scripts/verify-release-receipt.mjs" \
    "$work_dir" "$tag" "$1" "$oci_image" "$2" "$oci_amd64" "$oci_arm64"
}

verify_receipt "$commit" "$oci_index" >/dev/null
metadata=$(node "$root/scripts/release-receipt-metadata.mjs" "$work_dir/$receipt")
[ "$metadata" = "{\"version\":\"$version\",\"commit\":\"$commit\",\"oci_image\":\"$oci_image\",\"oci_index_digest\":\"$oci_index\",\"oci_linux_amd64_digest\":\"$oci_amd64\",\"oci_linux_arm64_digest\":\"$oci_arm64\"}" ]

if verify_receipt fedcba9876543210fedcba9876543210fedcba98 \
  "$oci_index" >/dev/null 2>&1; then
  fail 'a receipt for a different commit was accepted'
fi

if verify_receipt "$commit" \
  sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  >/dev/null 2>&1; then
  fail 'a receipt for a different OCI index was accepted'
fi

printf '%s\n' 'tampered archive' >> "$work_dir/$archive"
if verify_receipt "$commit" "$oci_index" >/dev/null 2>&1; then
  fail 'a release with an asset changed after receipt creation was accepted'
fi

printf '%s\n' 'release receipt smoke passed'
