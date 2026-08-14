#!/usr/bin/env bash
#
# Send one report through the relay, from a shell.
#
# Useful for the first smoke test after a deploy, before wiring anything up.
# The token comes from the environment and is never written on the command line
# — arguments are visible to every process on the machine via `ps`.
#
#   export MAIL_RELAY_URL=https://mail.apianalyser.com
#   export MAIL_RELAY_TOKEN=...            # the value of RELAY_SECRET
#   ./examples/send-report.sh you@example.com ./some-report.pdf "Production API"
#
set -euo pipefail

RECIPIENT="${1:?usage: send-report.sh <recipient> <path-to-pdf> [scan name]}"
PDF_PATH="${2:?usage: send-report.sh <recipient> <path-to-pdf> [scan name]}"
SCAN_NAME="${3:-}"

: "${MAIL_RELAY_URL:?set MAIL_RELAY_URL}"
: "${MAIL_RELAY_TOKEN:?set MAIL_RELAY_TOKEN}"

[ -f "$PDF_PATH" ] || { echo "No such file: $PDF_PATH" >&2; exit 1; }

# -w0: base64 wraps at 76 columns by default, and a JSON string cannot contain
# raw newlines. macOS uses -b0 instead.
PDF_BASE64="$(base64 -w0 "$PDF_PATH" 2>/dev/null || base64 -b0 "$PDF_PATH")"

# Build the body with a heredoc via a temp file so the multi-megabyte payload
# never becomes a command-line argument.
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

if [ -n "$SCAN_NAME" ]; then
  printf '{"email":"%s","scanName":"%s","filename":"%s","pdfBase64":"%s"}' \
    "$RECIPIENT" "$SCAN_NAME" "$(basename "$PDF_PATH")" "$PDF_BASE64" > "$BODY_FILE"
else
  printf '{"email":"%s","filename":"%s","pdfBase64":"%s"}' \
    "$RECIPIENT" "$(basename "$PDF_PATH")" "$PDF_BASE64" > "$BODY_FILE"
fi

curl --silent --show-error --fail-with-body \
  --request POST "${MAIL_RELAY_URL%/}/api/send-report" \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer ${MAIL_RELAY_TOKEN}" \
  --data-binary "@${BODY_FILE}"

echo
