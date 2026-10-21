#!/usr/bin/env bash
# The checks of flyermap-rs that need no browser: file size rule, format, lints, tests. Run before every push that touches flyermap-rs.
set -euo pipefail
cd "$(dirname "$0")/../flyermap-rs"
SOFT=300; HARD=500
fail=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  if [ "$n" -gt "$HARD" ]; then echo "TOO LONG ($n > $HARD lines): $f"; fail=1
  elif [ "$n" -gt "$SOFT" ]; then echo "long ($n > $SOFT lines): $f"; fi
done < <(find crates -name '*.rs' -not -path '*/target/*' -not -path '*/tests/vectors/*')
[ "$fail" = 0 ] || { echo "split the files above (one concept per file)"; exit 1; }
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
