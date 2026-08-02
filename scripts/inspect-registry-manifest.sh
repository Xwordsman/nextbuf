#!/bin/sh
set -eu

reference=${1:-}
if [ -z "$reference" ]; then
  printf '%s\n' 'Usage: scripts/inspect-registry-manifest.sh <registry-reference>' >&2
  exit 2
fi

error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT HUP INT TERM

if docker buildx imagetools inspect "$reference" >/dev/null 2>"$error_file"; then
  printf '%s\n' present
  exit 0
fi

absence_pattern='^[[:space:]]*(ERROR:[[:space:]]*)?(manifest unknown(: manifest unknown)?|name unknown(: repository name not known to registry)?|unexpected status from (a )?HEAD request .+: 404 Not Found|.+: not found)[[:space:]]*$'
if grep -Eq "$absence_pattern" "$error_file" \
  && ! grep -Ev "$absence_pattern|^[[:space:]]*$" "$error_file" | grep -q .; then
  printf '%s\n' absent
  exit 0
fi

printf '%s\n' "Registry inspection failed for $reference; refusing to treat it as absent." >&2
cat "$error_file" >&2
exit 1
