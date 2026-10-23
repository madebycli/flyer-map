#!/usr/bin/env bash
# The local test stack for the browser flows of the Rust app against real (if made-up) data, with no network:
#   map data source (Overpass stub, answers with a made-up neighbourhood) -> the Rust Worker in workerd (wrangler dev, local D1 seeded from the contract
#   vectors) -> the app's address (dist-rs plus /api/v5 passed on, one origin).
#   scripts/rs-web-build.sh --release        first (dist-rs)
#   scripts/rs-e2e/app-local.sh              start the stack, run the flows (default: sync, map, mark, search, studio, draw, join, offline), stop it
#   scripts/rs-e2e/app-local.sh flow1 flow2  other flows (names of scripts/rs-e2e/<name>.mjs)
#   HOLD=1 scripts/rs-e2e/app-local.sh       only start it and wait (run a flow by hand with BASE=http://127.0.0.1:8160/ node scripts/rs-e2e/<name>.mjs)
# Ports (override with APP_PORT, WORKER_PORT, STUB_PORT): app 8160, Worker 8790, stub 8795. Never touches production: everything is local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRATE="$ROOT/flyermap-rs/crates/flyermap-worker"
WORK="${TMPDIR:-/tmp}/flyermap-rs-app"
APP_PORT="${APP_PORT:-8160}"; WORKER_PORT="${WORKER_PORT:-8790}"; STUB_PORT="${STUB_PORT:-8795}"
W="$ROOT/node_modules/.bin/wrangler"
[ -f "$ROOT/dist-rs/index.html" ] || { echo "dist-rs is missing: scripts/rs-web-build.sh --release"; exit 1; }
mkdir -p "$ROOT/dist/client"   # the Worker's static assets directory (empty here: the app is served by app-server.mjs)

# the generator of the made-up neighbourhood (a native example of the web crate)
(cd "$ROOT/flyermap-rs" && cargo build -q -p flyermap-web --example synth_overpass)

rm -rf "$WORK" && mkdir -p "$WORK"
grep -v '^PRAGMA' "$CRATE/tests/vectors/v5.seed.sql" > "$WORK/seed.sql"
cd "$CRATE"
"$W" d1 execute DB -c wrangler.toml --local --persist-to "$WORK/d1" --file "$WORK/seed.sql" > "$WORK/seed.log" 2>&1
# the contract vectors seed ten Gebiete (most of them odd on purpose); the flows work with the two normal ones, a Gruppe each
"$W" d1 execute DB -c wrangler.toml --local --persist-to "$WORK/d1" --command \
  "DELETE FROM v5_pack_meta WHERE area_id NOT IN ('area_n','area_o'); DELETE FROM v5_packs WHERE area_id NOT IN ('area_n','area_o'); DELETE FROM areas WHERE id NOT IN ('area_n','area_o');" >> "$WORK/seed.log" 2>&1
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
setsid node "$ROOT/scripts/rs-e2e/overpass-stub.mjs" "$STUB_PORT" > "$WORK/stub.log" 2>&1 & PIDS+=($!)
setsid "$W" dev -c wrangler.toml --local --persist-to "$WORK/d1" --port "$WORKER_PORT" --ip 127.0.0.1 \
  --var RUNTIME_ENVIRONMENT:local-test --var TEST_FIXED_NOW_MS:1800000000000 --var V5_BASEMAP_DARK:off --var V5_BASEMAP_LIGHT:off \
  --var "OSM_OVERPASS_URL:http://127.0.0.1:$STUB_PORT/api/interpreter" > "$WORK/dev.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 150); do grep -q "Ready on" "$WORK/dev.log" && break; sleep 2; done
grep -q "Ready on" "$WORK/dev.log" || { echo "the Worker did not start:"; tail -20 "$WORK/dev.log"; exit 1; }
setsid node "$ROOT/scripts/rs-e2e/app-server.mjs" "$APP_PORT" "$WORKER_PORT" > "$WORK/app.log" 2>&1 & PIDS+=($!)
sleep 1
echo "stack is up: app http://127.0.0.1:$APP_PORT/  Worker http://127.0.0.1:$WORKER_PORT/  stub :$STUB_PORT"
if [ "${HOLD:-}" = "1" ]; then wait; fi
FLOWS=("$@"); [ ${#FLOWS[@]} -gt 0 ] || FLOWS=(local-sync local-map local-mark local-search local-studio local-draw local-join local-offline)
status=0
for f in "${FLOWS[@]}"; do
  echo "== $f"
  BASE="http://127.0.0.1:$APP_PORT/" WORKER="http://127.0.0.1:$WORKER_PORT" node "$ROOT/scripts/rs-e2e/$f.mjs" || status=1
done
exit $status
