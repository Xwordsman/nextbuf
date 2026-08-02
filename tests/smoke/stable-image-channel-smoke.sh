#!/bin/sh
set -eu

fail() {
  printf '%s\n' "stable image channel smoke failed: $*" >&2
  exit 1
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
mkdir -p "$work_dir/bin"

cat > "$work_dir/bin/docker" <<'EOF'
#!/bin/sh
set -eu

if [ "${1:-} ${2:-} ${3:-}" = 'buildx imagetools inspect' ]; then
  reference=$4
  if [ "${5:-}" = '--raw' ]; then
    if [ "${FAKE_LEGACY_IDENTITY:-0}" = 1 ]; then
      if [ "$reference" = 'ghcr.io/example/app:latest' ]; then
        amd64=sha256:76a7ef293182d8e45ea1cada579d0b7297777127cfc10a157c5b6c410b84df86
        arm64=sha256:7f4dfb7e583f7251fc66a203b51136a75c755eaa192f2bdee8486adc307b6a2e
      else
        amd64=sha256:f9041d079bfeaeae087730533db8927c2d5d0315360637e14b6d295021295cab
        arm64=sha256:8d110ff315fcbb0cb2f0fdea575ec07519a473620ac926dc65e4fcd90eef008a
      fi
    elif [ "${FAKE_MISMATCH:-0}" = 1 ] && [ "$reference" = 'ghcr.io/example/app:latest' ]; then
      amd64=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      arm64=sha256:2222222222222222222222222222222222222222222222222222222222222222
    else
      amd64=sha256:1111111111111111111111111111111111111111111111111111111111111111
      arm64=sha256:2222222222222222222222222222222222222222222222222222222222222222
    fi
    printf '%s\n' '{"manifests":['
    printf '%s' \
      "{\"digest\":\"$amd64\",\"platform\":{\"os\":\"linux\",\"architecture\":\"amd64\"}}"
    if [ "${FAKE_MISSING_ARM64:-0}" != 1 ]; then
      printf '%s' \
        ",{\"digest\":\"$arm64\",\"platform\":{\"os\":\"linux\",\"architecture\":\"arm64\"}}"
    fi
    printf '%s\n' \
      ',{"digest":"sha256:3333333333333333333333333333333333333333333333333333333333333333","platform":{"os":"unknown","architecture":"unknown"}}]}'
    if [ "${FAKE_RAW_EXIT_FAILURE:-0}" = 1 ]; then exit 1; fi
    exit 0
  fi
  if [ "${5:-}" = '--format' ]; then
    if [ "${FAKE_LEGACY_IDENTITY:-0}" = 1 ]; then
      if [ "$reference" = 'ghcr.io/example/app:latest' ]; then
        printf '%s\n' \
          "${FAKE_LATEST_INDEX_DIGEST:-sha256:99fb5681668cbea1c35fa0c1d62b719c8f996d69a2ce106e214ceec06484b60f}"
      else
        printf '%s\n' \
          'sha256:df9d61299a2db8287336f4b8c37855466fe19f94eb2427d000a319746299d21c'
      fi
      exit 0
    fi
    printf '%s\n' 'sha256:4444444444444444444444444444444444444444444444444444444444444444'
    exit 0
  fi
  if [ "${FAKE_LATEST_ABSENT:-0}" = 1 ] && [ "$reference" = 'ghcr.io/example/app:latest' ]; then
    printf '%s\n' "ERROR: $reference: not found" >&2
    exit 1
  fi
  exit 0
fi

if [ "${1:-}" = pull ]; then
  exit 0
fi
if [ "${1:-} ${2:-}" = 'image inspect' ]; then
  reference=${3:-}
  case "$reference" in
    *:latest)
      version=${FAKE_CURRENT_VERSION:-0.13.10}
      commit=${FAKE_LATEST_COMMIT:-1111111111111111111111111111111111111111}
      ;;
    *)
      version=${FAKE_VERSION_IMAGE_VERSION:-${FAKE_CURRENT_VERSION:-0.13.10}}
      commit=${FAKE_VERSION_COMMIT:-1111111111111111111111111111111111111111}
      ;;
  esac
  printf '%s\n' "NEXTBUF_VERSION=$version"
  printf '%s\n' "NEXTBUF_COMMIT=$commit"
  if [ "${FAKE_IMAGE_INSPECT_EXIT_FAILURE:-0}" = 1 ]; then exit 1; fi
  exit 0
fi

printf '%s\n' "unexpected fake Docker invocation: $*" >&2
exit 2
EOF
chmod +x "$work_dir/bin/docker"
PATH="$work_dir/bin:$PATH"
export PATH

assess() {
  sh "$root/scripts/assess-stable-image-channel.sh" ghcr.io/example/app "$1"
}

FAKE_LATEST_ABSENT=1
export FAKE_LATEST_ABSENT
[ "$(assess 1.0.0)" = 'promote:none' ] || fail 'an empty channel was not promotable'
FAKE_LATEST_ABSENT=0
export FAKE_LATEST_ABSENT

FAKE_CURRENT_VERSION=0.13.10
export FAKE_CURRENT_VERSION
[ "$(assess 1.0.0)" = 'promote:0.13.10' ] || fail 'the final Beta did not advance to v1'

FAKE_LEGACY_IDENTITY=1
export FAKE_LEGACY_IDENTITY
[ "$(assess 1.0.0)" = 'promote:0.13.10' ] \
  || fail 'the audited rolling-Beta manifest transition was not accepted'
if assess 1.0.1 >/dev/null 2>&1; then
  fail 'the rolling-Beta exception was accepted outside the exact v1.0.0 transition'
fi
FAKE_LATEST_INDEX_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export FAKE_LATEST_INDEX_DIGEST
if assess 1.0.0 >/dev/null 2>&1; then
  fail 'the rolling-Beta exception accepted an unrecorded manifest identity'
fi
FAKE_LEGACY_IDENTITY=0
unset FAKE_LATEST_INDEX_DIGEST
export FAKE_LEGACY_IDENTITY

FAKE_CURRENT_VERSION=1.0.0
export FAKE_CURRENT_VERSION
[ "$(assess 1.0.0)" = 'current:1.0.0' ] || fail 'an idempotent promotion was not detected'

FAKE_RAW_EXIT_FAILURE=1
export FAKE_RAW_EXIT_FAILURE
if assess 1.0.0 >/dev/null 2>&1; then
  fail 'a failed Registry response with parseable platform output was accepted'
fi
FAKE_RAW_EXIT_FAILURE=0
FAKE_IMAGE_INSPECT_EXIT_FAILURE=1
export FAKE_RAW_EXIT_FAILURE FAKE_IMAGE_INSPECT_EXIT_FAILURE
if assess 1.0.0 >/dev/null 2>&1; then
  fail 'a failed local image inspection with parseable output was accepted'
fi
FAKE_IMAGE_INSPECT_EXIT_FAILURE=0
export FAKE_IMAGE_INSPECT_EXIT_FAILURE

FAKE_CURRENT_VERSION=1.2.0
export FAKE_CURRENT_VERSION
[ "$(assess 1.1.0)" = 'newer:1.2.0' ] || fail 'a stable channel rollback was allowed'

FAKE_CURRENT_VERSION=1.0.0
export FAKE_CURRENT_VERSION
[ "$(assess 1.1.0)" = 'promote:1.0.0' ] || fail 'a forward stable promotion was rejected'

FAKE_MISMATCH=1
export FAKE_MISMATCH
if assess 1.1.0 >/dev/null 2>&1; then
  fail 'latest was accepted without matching its immutable SemVer manifest'
fi
FAKE_MISMATCH=0
FAKE_MISSING_ARM64=1
export FAKE_MISMATCH FAKE_MISSING_ARM64
if assess 1.1.0 >/dev/null 2>&1; then
  fail 'latest was accepted without both required architectures'
fi

printf '%s\n' 'stable image channel smoke passed'
