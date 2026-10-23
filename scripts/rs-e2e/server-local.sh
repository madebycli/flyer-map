#!/usr/bin/env bash
# Builds the Flyer Map 6 server, starts it in workerd (wrangler dev, local D1 from migrations/0001_directory.sql, Durable Objects with SQLite) and runs the
# Akteur flow (WebSockets, hibernation, rights that end) and the directory flow over HTTP.
#   scripts/rs-e2e/server-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRATE="$ROOT/flyermap-rs/crates/flyermap-server"
WORK="${TMPDIR:-/tmp}/flyermap-rs-server"
PORT="${PORT:-8791}"
W="$ROOT/node_modules/.bin/wrangler"
SETUP_KEY="local-setup-key"
rm -rf "$WORK" && mkdir -p "$WORK"
cd "$CRATE"
"$W" d1 execute DB -c wrangler.toml --local --persist-to "$WORK/d1" --file migrations/0001_directory.sql > "$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log"; exit 1; }
SEAL_KEY="$(node -e "console.log(Buffer.alloc(32, 7).toString('base64url'))")"
SETUP_SHA="$(printf '%s' "$SETUP_KEY" | sha256sum | cut -d' ' -f1)"
# the end-to-end build carries the probe that asks a real Durable Object whether its transactions are all-or-nothing; a deployed build never does
export FM_FEATURES=probe
setsid "$W" dev -c wrangler.toml --local --persist-to "$WORK/d1" --port "$PORT" --ip 127.0.0.1 \
  --var RP_ID:127.0.0.1 --var "ORIGINS:http://127.0.0.1:$PORT" --var "SETUP_KEY_SHA256:$SETUP_SHA" --var "SEAL_KEY:$SEAL_KEY" > "$WORK/dev.log" 2>&1 &
DEV=$!
trap 'kill -- -$DEV 2>/dev/null || kill $DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 200); do grep -q "Ready on" "$WORK/dev.log" && break; sleep 2; done
grep -q "Ready on" "$WORK/dev.log" || { echo "the server did not start:"; tail -30 "$WORK/dev.log"; exit 1; }
# the Akteur first: the directory flow ends by tripping the brake on invitation codes, which would lock the guests of the Akteur flow out
BASE="http://127.0.0.1:$PORT" SETUP_KEY="$SETUP_KEY" node "$ROOT/scripts/rs-e2e/akteur-flow.mjs"
BASE="http://127.0.0.1:$PORT" SETUP_KEY="$SETUP_KEY" node "$ROOT/scripts/rs-e2e/server-flow.mjs"
