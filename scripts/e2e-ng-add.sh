#!/bin/bash
# Usage: scripts/e2e-ng-add.sh <angular-cli-version> <path-to-ngx-cloudflare.tgz>
# Creates a fresh `ng new --ssr` app, runs `ng add` from the tarball, adds user code,
# then checks `wrangler dev` and `ng serve`. Exits non-zero on the first failed check.
set -euo pipefail

NG_VERSION=$1
TARBALL=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
WRANGLER_PORT=${E2E_WRANGLER_PORT:-8787}
SERVE_PORT=${E2E_SERVE_PORT:-4280}
export NG_CLI_ANALYTICS=false WRANGLER_SEND_METRICS=false

cleanup() {
  pkill -f "wrangler dev --port $WRANGLER_PORT" 2>/dev/null || true
  pkill -f "ng serve --port $SERVE_PORT" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  for log in "$WORK"/app/wd.log "$WORK"/app/ns.log; do
    [ -f "$log" ] && { echo "--- $log" >&2; tail -40 "$log" >&2; }
  done
  exit 1
}

expect() {
  local name=$1 actual=$2 pattern=$3
  if [[ "$actual" =~ $pattern ]]; then echo "ok   $name"; else fail "$name: got '$actual', expected /$pattern/"; fi
}

wait_for() {
  for _ in $(seq 1 120); do
    curl -s --noproxy '*' -o /dev/null "$1" && return 0
    sleep 1
  done
  fail "timed out waiting for $1"
}

cd "$WORK"
CI=true npx -y "@angular/cli@$NG_VERSION" new app --ssr --style css --skip-git --defaults >/dev/null
cd app
npx ng add "$TARBALL" --skip-confirmation
"$SCRIPTS/e2e-user-code.sh" "$WORK/app"

npx ng build
SERVER_DIR=$(node -e 'const c=require("jsonc-parser").parse(require("fs").readFileSync("wrangler.jsonc","utf8"));console.log(require("path").dirname(c.main))')
if grep -qE 'import\("wrangler"\)|from ?"wrangler"' "$SERVER_DIR"/*.mjs; then fail "the production server bundle imports wrangler"; fi
echo "ok   production bundle has no wrangler"

npx wrangler dev --port "$WRANGLER_PORT" >wd.log 2>&1 </dev/null &
wait_for "http://localhost:$WRANGLER_PORT/"
B="http://localhost:$WRANGLER_PORT"
expect "localhost is allowed" "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "$B/")" '^200$'
expect "*.workers.dev is allowed" "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -H 'Host: demo.someone.workers.dev' "$B/")" '^200$'
expect "other hosts are refused" "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -H 'Host: app.example.com' "$B/")" '^400$'
expect "api reads env and KV" "$(curl -s --noproxy '*' "$B/api/greeting")" '"greeting":"hello from env"'
PAGE=$(curl -s --noproxy '*' -H 'x-forwarded-for: 1.1.1.1' -H 'x-forwarded-proto: https' "$B/" | tr '\n' ' ')
expect "component reads env on Workers" "$PAGE" 'env=hello from env source=workers'
expect "own API call rendered" "$PAGE" 'api=\{ *"greeting": "hello from env"'
expect "own API call in transfer state" "$PAGE" '(/|\\u002F)api(/|\\u002F)greeting'
sleep 1
if grep -qiE "forwarded|NG0" wd.log; then fail "proxy-header or Angular warnings in the wrangler log"; fi
echo "ok   no proxy-header warnings"
cleanup

npx ng serve --port "$SERVE_PORT" >ns.log 2>&1 </dev/null &
wait_for "http://localhost:$SERVE_PORT/"
B="http://localhost:$SERVE_PORT"
expect "ng serve: api reads env and KV" "$(curl -s --noproxy '*' "$B/api/greeting")" '"greeting":"hello from env"'
expect "ng serve: component reads env" "$(curl -s --noproxy '*' "$B/")" 'env=hello from env source=platform-proxy'

echo "All checks passed for Angular $NG_VERSION."
