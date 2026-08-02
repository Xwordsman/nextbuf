#!/bin/sh
set -eu

repository=${1:-}
tag=${2:-}
asset_name=${3:-}
retries=${NEXTBUF_RELEASE_ASSET_DELETE_RETRIES:-5}
delay=${NEXTBUF_RELEASE_ASSET_DELETE_RETRY_DELAY_SECONDS:-2}

if [ -z "$repository" ] || [ -z "$tag" ] || [ -z "$asset_name" ]; then
  printf '%s\n' \
    'Usage: delete-github-release-asset.sh <owner/repository> <tag> <asset-name>' >&2
  exit 2
fi

attempt=1
asset_ids_from_json() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const document = JSON.parse(input);
      for (const asset of document.assets ?? []) {
        if (asset.name === process.argv[1]) console.log(asset.id);
      }
    });
  ' "$asset_name"
}

while [ "$attempt" -le "$retries" ]; do
  if release_json=$(gh api "repos/$repository/releases/tags/$tag"); then
    asset_ids=$(printf '%s' "$release_json" | asset_ids_from_json)
    if [ -z "$asset_ids" ]; then
      printf '%s\n' "Confirmed that $asset_name is absent from Release $tag"
      exit 0
    fi

    delete_failed=false
    for asset_id in $asset_ids; do
      if ! gh api --method DELETE "repos/$repository/releases/assets/$asset_id"; then
        delete_failed=true
      fi
    done
    if [ "$delete_failed" = false ]; then
      if release_json=$(gh api "repos/$repository/releases/tags/$tag"); then
        remaining_ids=$(printf '%s' "$release_json" | asset_ids_from_json)
        if [ -z "$remaining_ids" ]; then
          printf '%s\n' "Confirmed that $asset_name is absent from Release $tag"
          exit 0
        fi
      fi
      if [ "$attempt" -lt "$retries" ]; then sleep "$delay"; fi
      attempt=$((attempt + 1))
      continue
    fi
  fi

  if [ "$attempt" -lt "$retries" ]; then sleep "$delay"; fi
  attempt=$((attempt + 1))
done

printf '%s\n' "Failed to remove $asset_name from Release $tag after $retries attempts" >&2
exit 1
