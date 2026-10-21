#!/usr/bin/env bash
# Builds the Rust web app (flyermap-rs/crates/flyermap-web) into dist-rs/ without a Node bundler:
#   cargo (wasm32) -> wasm-bindgen --target web -> index.html, one app.css (the @imports of assets/css/app.css inlined), icons and logo.
#   scripts/rs-web-build.sh            debug build (fast, large)
#   scripts/rs-web-build.sh --release  release build (workspace profile `web`: the release profile with opt-level "z"; LTO, one codegen unit,
#                                      abort on panic). RS_WEB_PROFILE=release uses the plain release profile (opt-level 3) instead.
# Then: node scripts/rs-web-serve.mjs  (http://localhost:8150)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WS="$ROOT/flyermap-rs"
CRATE="$WS/crates/flyermap-web"
OUT="$ROOT/dist-rs"
PROFILE=debug; FLAG=()
[ "${1:-}" = "--release" ] && { PROFILE=${RS_WEB_PROFILE:-web}; FLAG=(--profile "$PROFILE"); }

# The wasm-bindgen CLI must be the version of the crate in Cargo.lock (scripts/rs-setup.sh installs it).
WANT=$(grep -A1 'name = "wasm-bindgen"$' "$WS/Cargo.lock" | sed -n 's/version = "\(.*\)"/\1/p' | head -1)
HAVE=$(wasm-bindgen --version | awk '{print $2}')
[ "$WANT" = "$HAVE" ] || { echo "wasm-bindgen CLI $HAVE does not match the crate $WANT: cargo install wasm-bindgen-cli --locked --version $WANT"; exit 1; }

(cd "$WS" && cargo build -p flyermap-web --bin flyermap-web --target wasm32-unknown-unknown "${FLAG[@]}")
rm -rf "$OUT"; mkdir -p "$OUT"
wasm-bindgen --target web --no-typescript --out-dir "$OUT" "$WS/target/wasm32-unknown-unknown/$PROFILE/flyermap-web.wasm"

cp "$CRATE/assets/web/index.html" "$OUT/index.html"
grep -o "@import '[^']*'" "$CRATE/assets/css/app.css" | sed "s/@import '\(.*\)'/\1/" | while read -r f; do cat "$CRATE/assets/css/$f"; echo; done > "$OUT/app.css"
for f in logo.svg icon.svg icon-192.png icon-512.png apple-touch-icon.png; do cp "$ROOT/public/$f" "$OUT/$f"; done

WASM="$OUT/flyermap-web_bg.wasm"
RAW=$(wc -c < "$WASM"); GZ=$(gzip -9 -c "$WASM" | wc -c)
BR=$(node -e "const z=require('zlib');process.stdout.write(String(z.brotliCompressSync(require('fs').readFileSync(process.argv[1]),{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}).length))" "$WASM")
JS=$(wc -c < "$OUT/flyermap-web.js"); CSS=$(wc -c < "$OUT/app.css")
echo "dist-rs ($PROFILE): wasm ${RAW} B raw, ${GZ} B gzip -9, ${BR} B brotli 11; js ${JS} B; css ${CSS} B"
