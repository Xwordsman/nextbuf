#!/bin/sh
set -eu

repository=${1:-}
tag=${2:-}
expected_commit=${3:-}
expected_oci_image=${4:-}
expected_oci_index_digest=${5:-}
expected_amd64_digest=${6:-}
expected_arm64_digest=${7:-}

if [ -z "$repository" ] || [ -z "$tag" ] || [ -z "$expected_commit" ] \
  || [ -z "$expected_oci_image" ] || [ -z "$expected_oci_index_digest" ] \
  || [ -z "$expected_amd64_digest" ] || [ -z "$expected_arm64_digest" ]; then
  printf '%s\n' \
    'Usage: scripts/verify-github-release.sh <owner/repository> <v-version> <commit> <oci-image> <index-digest> <amd64-digest> <arm64-digest>' >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

version=${tag#v}
archive="nextbuf-$version-linux-x64.tar.gz"
checksum="$archive.sha256"
sbom="nextbuf-$tag-sbom.spdx.json"
receipt="nextbuf-$tag-release-complete.txt"

case "$version" in
  *-*) expected_prerelease=true ;;
  *)
    if printf '%s\n' "$version" \
      | grep -Eq '^[1-9][0-9]*\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
      expected_prerelease=false
    else
      expected_prerelease=true
    fi
    ;;
esac

release_json=$(gh api "repos/$repository/releases/tags/$tag")
release_tag=$(printf '%s' "$release_json" | jq -r '.tag_name')
release_draft=$(printf '%s' "$release_json" | jq -r '.draft')
release_prerelease=$(printf '%s' "$release_json" | jq -r '.prerelease')
if [ "$release_tag" != "$tag" ] || [ "$release_draft" != false ]; then
  printf '%s\n' "Release $tag is missing, draft, or resolves to a different tag" >&2
  exit 1
fi
if [ "$release_prerelease" != "$expected_prerelease" ]; then
  printf '%s\n' "Release $tag has an unexpected prerelease classification" >&2
  exit 1
fi

sh "$script_dir/verify-github-tag-commit.sh" \
  "$repository" "$tag" "$expected_commit" >/dev/null

for asset in "$archive" "$checksum" "$sbom" "$receipt"; do
  asset_id=$(printf '%s' "$release_json" | jq -r --arg name "$asset" \
    '[.assets[] | select(.name == $name) | .id] | if length == 1 then .[0] else empty end')
  if [ -z "$asset_id" ]; then
    printf '%s\n' "Release $tag does not contain exactly one $asset asset" >&2
    exit 1
  fi
  gh api --method GET -H 'Accept: application/octet-stream' \
    "repos/$repository/releases/assets/$asset_id" > "$work_dir/$asset"
done

node "$script_dir/verify-release-receipt.mjs" \
  "$work_dir" "$tag" "$expected_commit" "$expected_oci_image" \
  "$expected_oci_index_digest" "$expected_amd64_digest" "$expected_arm64_digest"
