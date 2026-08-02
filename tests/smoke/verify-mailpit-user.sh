#!/bin/sh
set -eu

MAILPIT_API_URL=${1:?Usage: verify-mailpit-user.sh <mailpit-api-url> <recipient> <application-origin> [timeout-seconds]}
RECIPIENT=${2:?Usage: verify-mailpit-user.sh <mailpit-api-url> <recipient> <application-origin> [timeout-seconds]}
APPLICATION_ORIGIN=${3:?Usage: verify-mailpit-user.sh <mailpit-api-url> <recipient> <application-origin> [timeout-seconds]}
TIMEOUT_SECONDS=${4:-120}
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/nextbuf-mailpit-verification.XXXXXX")

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
message_id=
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl --fail --silent --show-error --max-time 10 \
    "$MAILPIT_API_URL/api/v1/messages" >"$TMP_ROOT/messages.json"; then
    message_id=$(node - "$TMP_ROOT/messages.json" "$RECIPIENT" <<'NODE'
const fs = require("node:fs");
const [file, recipient] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, "utf8"));
const expected = recipient.toLowerCase();
const message = (report.messages ?? []).find((candidate) =>
  (candidate.To ?? []).some((entry) => String(entry.Address ?? "").toLowerCase() === expected),
);
process.stdout.write(String(message?.ID ?? ""));
NODE
    )
  fi
  [ -z "$message_id" ] || break
  sleep 2
done

if [ -z "$message_id" ]; then
  printf 'Timed out waiting for the verification message for %s\n' "$RECIPIENT" >&2
  exit 1
fi

curl --fail --silent --show-error --max-time 10 \
  "$MAILPIT_API_URL/api/v1/message/$message_id" >"$TMP_ROOT/message.json"
verification_url=$(node - "$TMP_ROOT/message.json" "$APPLICATION_ORIGIN" <<'NODE'
const fs = require("node:fs");
const [file, expectedOrigin] = process.argv.slice(2);
const message = JSON.parse(fs.readFileSync(file, "utf8"));
const source = [message.Text, message.HTML].filter(Boolean).join("\n").replaceAll("&amp;", "&");
const candidates = source.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
for (const candidate of candidates) {
  try {
    const url = new URL(candidate);
    if (
      url.origin === expectedOrigin &&
      url.pathname === "/api/auth/verify-email" &&
      url.searchParams.has("token")
    ) {
      process.stdout.write(url.toString());
      process.exit(0);
    }
  } catch {}
}
process.exit(1);
NODE
)

curl --fail --silent --show-error --max-time 15 --output /dev/null \
  -H "origin: $APPLICATION_ORIGIN" "$verification_url"
