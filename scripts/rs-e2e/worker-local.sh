#!/usr/bin/env bash
# Builds the Rust Worker, starts it in workerd (wrangler dev, local D1 seeded from the contract vectors) and replays the recorded exchanges over HTTP.
#   scripts/rs-e2e/worker-local.sh           build, seed, start, replay, stop
#   VECTORS=base scripts/rs-e2e/worker-local.sh   another vector set (tests/vectors/<name>.json and <name>.seed.sql; default v5)
#   EXTRA_VARS="--var NAME:value ..."            more Worker variables for that set
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRATE="$ROOT/flyermap-rs/crates/flyermap-worker"
WORK="${TMPDIR:-/tmp}/flyermap-rs-worker"
PORT="${PORT:-8788}"
VECTORS="${VECTORS:-v5}"
W="$ROOT/node_modules/.bin/wrangler"
rm -rf "$WORK" && mkdir -p "$WORK"
grep -v '^PRAGMA' "$CRATE/tests/vectors/$VECTORS.seed.sql" > "$WORK/seed.sql"
cd "$CRATE"
"$W" d1 execute DB -c wrangler.toml --local --persist-to "$WORK/d1" --file "$WORK/seed.sql" > "$WORK/seed.log" 2>&1
setsid "$W" dev -c wrangler.toml --local --persist-to "$WORK/d1" --port "$PORT" --ip 127.0.0.1 \
  --var RUNTIME_ENVIRONMENT:local-test --var TEST_FIXED_NOW_MS:1800000000000 --var V5_BASEMAP_DARK:off --var V5_BASEMAP_LIGHT:off \
  --var OSM_OVERPASS_URL:http://127.0.0.1:8799/api/interpreter ${EXTRA_VARS:-} > "$WORK/dev.log" 2>&1 &
DEV=$!
# wrangler starts workerd as a child: stop the whole session, or the next run finds the port taken
trap 'kill -- -$DEV 2>/dev/null || kill $DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 150); do grep -q "Ready on" "$WORK/dev.log" && break; sleep 2; done
grep -q "Ready on" "$WORK/dev.log" || { echo "the Worker did not start:"; tail -20 "$WORK/dev.log"; exit 1; }
VECTORS="$VECTORS" BASE="http://127.0.0.1:$PORT" node "$ROOT/scripts/rs-e2e/worker-contract.mjs"
