#!/bin/sh
set -eu

fail() {
  printf '%s\n' "registry channel state smoke failed: $*" >&2
  exit 1
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
mkdir -p "$work_dir/bin"

cat > "$work_dir/bin/docker" <<'EOF'
#!/bin/sh
set -eu

case "${FAKE_DOCKER_RESULT:-}" in
  present)
    exit 0
    ;;
  absent)
    printf '%s\n' 'ERROR: ghcr.io/example/app:TAG: not found' >&2
    exit 1
    ;;
  manifest-unknown)
    printf '%s\n' 'ERROR: manifest unknown' >&2
    exit 1
    ;;
  mixed-absence-server-error)
    printf '%s\n' 'ERROR: manifest unknown' >&2
    printf '%s\n' 'ERROR: unexpected status from HEAD request: 500 Internal Server Error' >&2
    exit 1
    ;;
  timeout)
    printf '%s\n' 'ERROR: context deadline exceeded' >&2
    exit 1
    ;;
  denied)
    printf '%s\n' 'ERROR: denied: permission_denied' >&2
    exit 1
    ;;
  credential-missing)
    printf '%s\n' 'ERROR: exec: docker-credential-helper: executable file not found' >&2
    exit 1
    ;;
  *)
    printf '%s\n' 'unexpected fake Docker invocation' >&2
    exit 2
    ;;
esac
EOF
chmod +x "$work_dir/bin/docker"
PATH="$work_dir/bin:$PATH"
export PATH

FAKE_DOCKER_RESULT=present
export FAKE_DOCKER_RESULT
[ "$(sh "$root/scripts/inspect-registry-manifest.sh" ghcr.io/example/app:TAG)" = present ] \
  || fail 'an existing manifest was not detected'

for result in absent manifest-unknown; do
  FAKE_DOCKER_RESULT=$result
  export FAKE_DOCKER_RESULT
  [ "$(sh "$root/scripts/inspect-registry-manifest.sh" ghcr.io/example/app:TAG)" = absent ] \
    || fail "$result was not classified as an explicit absence"
done

for result in timeout denied credential-missing mixed-absence-server-error; do
  FAKE_DOCKER_RESULT=$result
  export FAKE_DOCKER_RESULT
  if sh "$root/scripts/inspect-registry-manifest.sh" ghcr.io/example/app:TAG \
    >/dev/null 2>&1; then
    fail "$result was incorrectly treated as an absent manifest"
  fi
done

printf '%s\n' 'registry channel state smoke passed'
