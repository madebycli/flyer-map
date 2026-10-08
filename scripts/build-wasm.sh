#!/usr/bin/env bash
# Rebuilds src/v5/engine/wasm/engine.wasm from engine-rs. The artifact is committed so a normal build needs no Rust toolchain;
# tests/v5Wasm.test.ts compares it against the TypeScript reference, and its recorded digest must match engine-rs.
set -euo pipefail
cd "$(dirname "$0")/../engine-rs"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/verteil_engine.wasm ../src/v5/engine/wasm/engine.wasm
ls -l ../src/v5/engine/wasm/engine.wasm
# Digest of the Rust sources the artifact was built from; tests/v5Wasm.test.ts fails when sources and artifact drift apart.
(cd .. && find engine-rs/src engine-rs/Cargo.toml engine-rs/Cargo.lock -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1 > src/v5/engine/wasm/engine.source.sha256)
cat ../src/v5/engine/wasm/engine.source.sha256
