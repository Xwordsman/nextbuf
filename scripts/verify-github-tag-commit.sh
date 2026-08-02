#!/bin/sh
set -eu

repository=${1:-}
tag=${2:-}
expected_commit=${3:-}
if [ -z "$repository" ] || [ -z "$tag" ] || [ -z "$expected_commit" ]; then
  printf '%s\n' \
    'Usage: scripts/verify-github-tag-commit.sh <owner/repository> <v-version> <commit>' >&2
  exit 2
fi
if ! printf '%s\n' "$tag" \
  | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'; then
  printf '%s\n' "Invalid release tag: $tag" >&2
  exit 2
fi
if ! printf '%s\n' "$expected_commit" | grep -Eq '^[0-9a-f]{40}$'; then
  printf '%s\n' 'Expected commit must be a full lowercase Git SHA' >&2
  exit 2
fi

object_type=$(gh api "repos/$repository/git/ref/tags/$tag" --jq '.object.type')
object_sha=$(gh api "repos/$repository/git/ref/tags/$tag" --jq '.object.sha')
depth=0
while [ "$object_type" = tag ]; do
  depth=$((depth + 1))
  if [ "$depth" -gt 8 ]; then
    printf '%s\n' "Tag $tag exceeds the supported annotation depth" >&2
    exit 1
  fi
  tag_json=$(gh api "repos/$repository/git/tags/$object_sha")
  object_type=$(printf '%s' "$tag_json" | jq -r '.object.type')
  object_sha=$(printf '%s' "$tag_json" | jq -r '.object.sha')
done
if [ "$object_type" != commit ] || [ "$object_sha" != "$expected_commit" ]; then
  printf '%s\n' "Tag $tag does not resolve to expected commit $expected_commit" >&2
  exit 1
fi

printf '%s\n' "Verified tag $tag at $expected_commit"
