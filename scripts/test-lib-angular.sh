#!/bin/bash
# Usage: scripts/test-lib-angular.sh <angular-major>
# Runs the library's Angular unit tests against one Angular version, in a temporary folder.
set -euo pipefail

NG=$1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/projects"
cp -R "$ROOT/projects/ngx-cloudflare" "$WORK/projects/ngx-cloudflare"
VITEST=$(node -p "require('$ROOT/package.json').devDependencies.vitest")
JSDOM=$(node -p "require('$ROOT/package.json').devDependencies.jsdom")

cd "$WORK"
cat > package.json <<JSON
{ "name": "ngx-cloudflare-angular-$NG", "private": true, "type": "module" }
JSON
npm install --no-audit --no-fund --loglevel=error \
  "@angular/core@$NG" "@angular/common@$NG" "@angular/compiler@$NG" \
  "@angular/platform-browser@$NG" "@angular/platform-server@$NG" "@angular/router@$NG" \
  "@angular/ssr@$NG" "rxjs@^7.8.0" "vitest@$VITEST" "jsdom@$JSDOM"

echo "Testing against $(node -p "require('@angular/core/package.json').version")"
npx vitest run --config projects/ngx-cloudflare/vitest.angular.config.mts
