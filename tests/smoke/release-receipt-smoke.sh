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
release_body="$work_dir/release-body.md"
oci_image=ghcr.io/xwordsman/nextbuf
oci_index=sha256:1111111111111111111111111111111111111111111111111111111111111111
oci_amd64=sha256:2222222222222222222222222222222222222222222222222222222222222222
oci_arm64=sha256:3333333333333333333333333333333333333333333333333333333333333333

printf '%s\n' 'archive fixture' > "$work_dir/$archive"
printf '%s\n' '{"spdxVersion":"SPDX-2.3"}' > "$work_dir/$sbom"
printf '%s\n' '# NextBuf 1.0.0' '' 'Verified release body.' > "$release_body"
(cd "$work_dir" && sha256sum --text -- "$archive" > "$checksum")
{
  printf 'version=%s\n' "$version"
  printf 'commit=%s\n' "$commit"
  printf 'oci_image=%s\n' "$oci_image"
  printf 'oci_index_digest=%s\n' "$oci_index"
  printf 'oci_linux_amd64_digest=%s\n' "$oci_amd64"
  printf 'oci_linux_arm64_digest=%s\n' "$oci_arm64"
  printf 'release_body_sha256=%s\n' "$(sha256sum -- "$release_body" | awk '{print $1}')"
  (cd "$work_dir" && sha256sum --text -- "$archive" "$checksum" "$sbom" | sort)
} > "$work_dir/$receipt"

verify_receipt() {
  node "$root/scripts/verify-release-receipt.mjs" \
    "$work_dir" "$tag" "$1" "$oci_image" "$2" "$oci_amd64" "$oci_arm64" \
    "$release_body"
}

verify_receipt "$commit" "$oci_index" >/dev/null
metadata=$(node "$root/scripts/release-receipt-metadata.mjs" "$work_dir/$receipt")
[ "$metadata" = "{\"version\":\"$version\",\"commit\":\"$commit\",\"oci_image\":\"$oci_image\",\"oci_index_digest\":\"$oci_index\",\"oci_linux_amd64_digest\":\"$oci_amd64\",\"oci_linux_arm64_digest\":\"$oci_arm64\",\"release_body_sha256\":\"$(sha256sum -- "$release_body" | awk '{print $1}')\"}" ]

if command -v jq >/dev/null 2>&1; then
  mkdir -p "$work_dir/bin"
  cat > "$work_dir/bin/gh" <<'EOF'
#!/bin/sh
set -eu

if [ "${1:-}" != api ]; then exit 2; fi
if [ "${2:-}" = "repos/$FAKE_REPOSITORY/releases/tags/$FAKE_TAG" ]; then
  cat "$FAKE_RELEASE_JSON"
  exit 0
fi
if [ "${2:-}" = "repos/$FAKE_REPOSITORY/git/ref/tags/$FAKE_TAG" ]; then
  case "${4:-}" in
    .object.type) printf '%s\n' commit ;;
    .object.sha) printf '%s\n' "$FAKE_COMMIT" ;;
    *) exit 2 ;;
  esac
  exit 0
fi
if [ "${2:-}" = --method ] && [ "${3:-}" = GET ]; then
  case "${6:-}" in
    */assets/1) cat "$FAKE_RELEASE_DIR/$FAKE_ARCHIVE" ;;
    */assets/2) cat "$FAKE_RELEASE_DIR/$FAKE_CHECKSUM" ;;
    */assets/3) cat "$FAKE_RELEASE_DIR/$FAKE_SBOM" ;;
    */assets/4) cat "$FAKE_RELEASE_DIR/$FAKE_RECEIPT" ;;
    *) exit 2 ;;
  esac
  exit 0
fi
exit 2
EOF
  chmod +x "$work_dir/bin/gh"

  write_release_json() {
    jq -n --rawfile body "$1" \
      --arg tag "$tag" \
      --arg archive "$archive" \
      --arg checksum "$checksum" \
      --arg sbom "$sbom" \
      --arg receipt "$receipt" \
      '{tag_name: $tag, draft: false, prerelease: false, body: $body,
        assets: [
          {id: 1, name: $archive},
          {id: 2, name: $checksum},
          {id: 3, name: $sbom},
          {id: 4, name: $receipt}
        ]}' > "$work_dir/release.json"
  }

  FAKE_REPOSITORY=owner/repository
  FAKE_TAG=$tag
  FAKE_COMMIT=$commit
  FAKE_RELEASE_JSON="$work_dir/release.json"
  FAKE_RELEASE_DIR=$work_dir
  FAKE_ARCHIVE=$archive
  FAKE_CHECKSUM=$checksum
  FAKE_SBOM=$sbom
  FAKE_RECEIPT=$receipt
  export FAKE_REPOSITORY FAKE_TAG FAKE_COMMIT FAKE_RELEASE_JSON
  export FAKE_RELEASE_DIR FAKE_ARCHIVE FAKE_CHECKSUM FAKE_SBOM FAKE_RECEIPT
  PATH="$work_dir/bin:$PATH"
  export PATH

  write_release_json "$release_body"
  sh "$root/scripts/verify-github-release.sh" \
    "$FAKE_REPOSITORY" "$tag" "$commit" "$oci_image" \
    "$oci_index" "$oci_amd64" "$oci_arm64" >/dev/null

  cp "$release_body" "$work_dir/tampered-release-body.md"
  printf '%s\n' 'remote tampering' >> "$work_dir/tampered-release-body.md"
  write_release_json "$work_dir/tampered-release-body.md"
  if sh "$root/scripts/verify-github-release.sh" \
    "$FAKE_REPOSITORY" "$tag" "$commit" "$oci_image" \
    "$oci_index" "$oci_amd64" "$oci_arm64" >/dev/null 2>&1; then
    fail 'a GitHub Release body changed after receipt creation was accepted'
  fi
fi

if verify_receipt fedcba9876543210fedcba9876543210fedcba98 \
  "$oci_index" >/dev/null 2>&1; then
  fail 'a receipt for a different commit was accepted'
fi

if verify_receipt "$commit" \
  sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  >/dev/null 2>&1; then
  fail 'a receipt for a different OCI index was accepted'
fi

cp "$work_dir/$receipt" "$work_dir/$receipt.with-valid-body-hash"
sed 's/^release_body_sha256=.*/release_body_sha256=0000000000000000000000000000000000000000000000000000000000000000/' \
  "$work_dir/$receipt.with-valid-body-hash" > "$work_dir/$receipt"
if verify_receipt "$commit" "$oci_index" >/dev/null 2>&1; then
  fail 'a forged release body hash was accepted'
fi
mv "$work_dir/$receipt.with-valid-body-hash" "$work_dir/$receipt"

cp "$work_dir/$receipt" "$work_dir/$receipt.with-body-hash"
sed '/^release_body_sha256=/d' "$work_dir/$receipt.with-body-hash" > "$work_dir/$receipt"
if verify_receipt "$commit" "$oci_index" >/dev/null 2>&1; then
  fail 'a legacy receipt without a release body hash was accepted'
fi
if node "$root/scripts/release-receipt-metadata.mjs" \
  "$work_dir/$receipt" >/dev/null 2>&1; then
  fail 'legacy receipt metadata without a release body hash was accepted'
fi
mv "$work_dir/$receipt.with-body-hash" "$work_dir/$receipt"

printf '%s\n' 'tampered release body' >> "$release_body"
if verify_receipt "$commit" "$oci_index" >/dev/null 2>&1; then
  fail 'a release body changed after receipt creation was accepted'
fi
printf '%s\n' '# NextBuf 1.0.0' '' 'Verified release body.' > "$release_body"

printf '%s\n' 'tampered archive' >> "$work_dir/$archive"
if verify_receipt "$commit" "$oci_index" >/dev/null 2>&1; then
  fail 'a release with an asset changed after receipt creation was accepted'
fi

printf '%s\n' 'release receipt smoke passed'
