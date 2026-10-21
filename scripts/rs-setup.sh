#!/usr/bin/env bash
# Installs the Rust tools flyermap-rs needs (once per machine). Versions follow flyermap-rs/Cargo.lock: wasm-bindgen CLI must match the crate.
set -euo pipefail
rustup target add wasm32-unknown-unknown
WB=$(grep -A1 'name = "wasm-bindgen"$' "$(dirname "$0")/../flyermap-rs/Cargo.lock" 2>/dev/null | sed -n 's/version = "\(.*\)"/\1/p' | head -1)
cargo install wasm-bindgen-cli --locked ${WB:+--version "$WB"}
cargo install worker-build --locked
