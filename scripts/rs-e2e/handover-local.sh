#!/usr/bin/env bash
# The hand-over as it will run on Unstable, locally: the TypeScript Worker in front (worker/indexOrganizer.ts) with the service binding RUST_API
# to the Rust Worker and RUST_ROUTES=v5, both on one local D1 seeded from the contract vectors. Replays the v5 vectors through the front and
# demands that every answer came from the Rust Worker (x-served-by) and matches the TypeScript recording.
#   scripts/rs-e2e/handover-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRATE="$ROOT/flyermap-rs/crates/flyermap-worker"
WORK="${TMPDIR:-/tmp}/flyermap-rs-handover"
PORT="${PORT:-8790}"
W="$ROOT/node_modules/.bin/wrangler"
DB_ID="00000000-0000-0000-0000-000000000000"
rm -rf "$WORK" && mkdir -p "$WORK"
[[ -d "$ROOT/dist/client" ]] || (cd "$ROOT" && npm run build >/dev/null)
grep -v '^PRAGMA' "$CRATE/tests/vectors/v5.seed.sql" > "$WORK/seed.sql"
# The Rust Worker behind the binding: no assets, the fixed clock of the recording, the Overpass stub of the replay.
RUST_CFG="$CRATE/.wrangler.handover.toml"
trap 'rm -f "$RUST_CFG"' EXIT
sed '/^\[assets\]/,$d' "$CRATE/wrangler.toml" > "$RUST_CFG"
cat >> "$RUST_CFG" <<TOML
[vars]
RUNTIME_ENVIRONMENT = "local-test"
TEST_FIXED_NOW_MS = "1800000000000"
V5_BASEMAP_DARK = "off"
V5_BASEMAP_LIGHT = "off"
OSM_OVERPASS_URL = "http://127.0.0.1:8799/api/interpreter"
TOML
# The TypeScript Worker in front: the repository config with a local D1 (never the production id) and the binding.
node - "$ROOT" "$WORK/front.jsonc" "$DB_ID" <<'NODE'
const fs = require('node:fs'); const path = require('node:path');
const [root, out, id] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gmu, ''));
c.name = 'flyer-map-front-local';
c.main = path.join(root, c.main);
c.assets = { ...c.assets, directory: path.join(root, 'dist/client') };
c.d1_databases = [{ binding: 'DB', database_name: 'flyermap-rs-local', database_id: id }];
c.services = [{ binding: 'RUST_API', service: 'flyermap-rs-local' }];
c.vars = { ...(c.vars || {}), RUST_ROUTES: 'v5', RUNTIME_ENVIRONMENT: 'local-test' };
delete c.routes;
fs.writeFileSync(out, JSON.stringify(c, null, 2));
NODE
cd "$CRATE"
"$W" d1 execute DB -c "$RUST_CFG" --local --persist-to "$WORK/d1" --file "$WORK/seed.sql" > "$WORK/seed.log" 2>&1
setsid "$W" dev -c "$WORK/front.jsonc" -c "$RUST_CFG" --local --persist-to "$WORK/d1" --port "$PORT" --ip 127.0.0.1 > "$WORK/dev.log" 2>&1 &
DEV=$!
trap 'rm -f "$RUST_CFG"; kill -- -$DEV 2>/dev/null || kill $DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 150); do grep -q "Ready on" "$WORK/dev.log" && break; sleep 2; done
grep -q "Ready on" "$WORK/dev.log" || { echo "the Workers did not start:"; tail -30 "$WORK/dev.log"; exit 1; }
SERVED_BY=flyermap-rs VECTORS=v5 BASE="http://127.0.0.1:$PORT" node "$ROOT/scripts/rs-e2e/worker-contract.mjs"
