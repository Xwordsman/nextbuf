#!/bin/sh
set -eu

image=${1:-}
candidate_version=${2:-}
if [ -z "$image" ] || [ -z "$candidate_version" ]; then
  printf '%s\n' \
    'Usage: scripts/assess-stable-image-channel.sh <registry-image> <candidate-version>' >&2
  exit 2
fi
if ! printf '%s\n' "$candidate_version" \
  | grep -Eq '^[1-9][0-9]*\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  printf '%s\n' "Candidate is not a stable v1+ version: $candidate_version" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
latest_state=$(sh "$script_dir/inspect-registry-manifest.sh" "$image:latest")
if [ "$latest_state" = absent ]; then
  printf '%s\n' 'promote:none'
  exit 0
fi
if [ "$latest_state" != present ]; then
  printf '%s\n' "Unexpected latest manifest state: $latest_state" >&2
  exit 1
fi

docker pull "$image:latest" >/dev/null
image_environment=$(mktemp)
trap 'rm -f "$image_environment"' EXIT HUP INT TERM
if ! docker image inspect "$image:latest" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' >"$image_environment"; then
  printf '%s\n' 'Failed to inspect the current latest image configuration.' >&2
  exit 1
fi
current_versions=$(sed -n 's/^NEXTBUF_VERSION=//p' "$image_environment")
current_version_count=$(printf '%s\n' "$current_versions" | sed '/^$/d' | wc -l | tr -d ' ')
if [ "$current_version_count" != 1 ]; then
  printf '%s\n' 'The current latest image must contain exactly one NEXTBUF_VERSION.' >&2
  exit 1
fi
current_version=$(printf '%s\n' "$current_versions" | sed -n '1p')
if ! printf '%s\n' "$current_version" \
  | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  printf '%s\n' "The current latest image has an invalid stable version: $current_version" >&2
  exit 1
fi

version_state=$(sh "$script_dir/inspect-registry-manifest.sh" "$image:$current_version")
if [ "$version_state" != present ]; then
  printf '%s\n' \
    "The current latest image does not have an immutable $current_version manifest." >&2
  exit 1
fi

platform_members() {
  raw_manifest=$(mktemp)
  if ! docker buildx imagetools inspect "$1" --raw >"$raw_manifest"; then
    rm -f "$raw_manifest"
    return 1
  fi
  if ! members=$(node "$script_dir/oci-platform-members.mjs" <"$raw_manifest"); then
    rm -f "$raw_manifest"
    return 1
  fi
  rm -f "$raw_manifest"
  printf '%s\n' "$members"
}

assert_dual_platform_manifest() {
  members=$1
  label=$2
  amd64_count=$(printf '%s\n' "$members" \
    | grep -Ec '^linux/amd64=sha256:[0-9a-f]{64}$' || true)
  arm64_count=$(printf '%s\n' "$members" \
    | grep -Ec '^linux/arm64=sha256:[0-9a-f]{64}$' || true)
  total_count=$(printf '%s\n' "$members" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$amd64_count" != 1 ] || [ "$arm64_count" != 1 ] || [ "$total_count" != 2 ]; then
    printf '%s\n' "$label is not the expected amd64/arm64 manifest." >&2
    exit 1
  fi
}

latest_members=$(platform_members "$image:latest")
version_members=$(platform_members "$image:$current_version")
assert_dual_platform_manifest "$latest_members" 'The current latest image'
if [ "$latest_members" != "$version_members" ]; then
  # ADR-0018 let main keep moving latest after v0.13.10 was tagged. Admit only
  # the exact, recorded final rolling-Beta identities during the first stable
  # promotion. Stable v1+ channels remain digest-strict.
  if [ "$current_version" != '0.13.10' ] || [ "$candidate_version" != '1.0.0' ]; then
    printf '%s\n' \
      "The current latest image does not match immutable version $current_version." >&2
    exit 1
  fi

  assert_dual_platform_manifest "$version_members" "Immutable version $current_version"
  latest_digest=$(docker buildx imagetools inspect "$image:latest" \
    --format '{{.Manifest.Digest}}')
  version_digest=$(docker buildx imagetools inspect "$image:$current_version" \
    --format '{{.Manifest.Digest}}')
  expected_latest_digest='sha256:99fb5681668cbea1c35fa0c1d62b719c8f996d69a2ce106e214ceec06484b60f'
  expected_version_digest='sha256:df9d61299a2db8287336f4b8c37855466fe19f94eb2427d000a319746299d21c'
  expected_latest_members='linux/amd64=sha256:76a7ef293182d8e45ea1cada579d0b7297777127cfc10a157c5b6c410b84df86
linux/arm64=sha256:7f4dfb7e583f7251fc66a203b51136a75c755eaa192f2bdee8486adc307b6a2e'
  expected_version_members='linux/amd64=sha256:f9041d079bfeaeae087730533db8927c2d5d0315360637e14b6d295021295cab
linux/arm64=sha256:8d110ff315fcbb0cb2f0fdea575ec07519a473620ac926dc65e4fcd90eef008a'
  if [ "$latest_digest" != "$expected_latest_digest" ] \
    || [ "$version_digest" != "$expected_version_digest" ] \
    || [ "$latest_members" != "$expected_latest_members" ] \
    || [ "$version_members" != "$expected_version_members" ]; then
    printf '%s\n' \
      'The v0.13.10 transition does not match the audited rolling-Beta identities.' >&2
    exit 1
  fi
  printf '%s\n' \
    'Accepting the audited v0.13.10 rolling-Beta transition.' >&2
fi

if [ "$current_version" = "$candidate_version" ]; then
  printf '%s\n' "current:$current_version"
  exit 0
fi

highest=$(printf '%s\n%s\n' "$current_version" "$candidate_version" | sort -V | tail -n 1)
if [ "$highest" = "$current_version" ]; then
  printf '%s\n' "newer:$current_version"
else
  printf '%s\n' "promote:$current_version"
fi
