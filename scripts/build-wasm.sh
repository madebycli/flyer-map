#!/usr/bin/env bash
# Rebuilds src/v5/engine/wasm/engine.wasm from flyermap-rs/crates/flyermap-engine. The artifact is committed so a normal build needs no Rust toolchain;
# tests/v5Wasm.test.ts compares it against the TypeScript reference, and its recorded digest must match the engine sources.
set -euo pipefail
cd "$(dirname "$0")/../flyermap-rs"
cargo build --release --target wasm32-unknown-unknown -p flyermap-engine
cp target/wasm32-unknown-unknown/release/flyermap_engine.wasm ../src/v5/engine/wasm/engine.wasm
ls -l ../src/v5/engine/wasm/engine.wasm
# Digest of the engine sources the artifact was built from (its src and manifest; the workspace lock changes with other crates and is not part of it).
E=flyermap-rs/crates/flyermap-engine
(cd .. && find $E/src $E/Cargo.toml -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1 > src/v5/engine/wasm/engine.source.sha256)
cat ../src/v5/engine/wasm/engine.source.sha256
