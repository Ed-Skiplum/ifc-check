#!/usr/bin/env bash
# Build ifcfast's wasm module and vendor it into vendor/ifcfast-wasm/.
#
# ifcfast is a separate, read-only repository. Nothing here modifies it: the
# source is downloaded as a tarball into a scratch directory, built, and the
# wasm-bindgen output copied out. Set IFCFAST_REV to pin a commit.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rev="${IFCFAST_REV:-main}"
work="$here/_wasmbuild"
out="$here/vendor/ifcfast-wasm"

export PATH="$HOME/.cargo/bin:$PATH"

command -v cargo >/dev/null || { echo "cargo not found"; exit 1; }
rustup target list --installed | grep -q wasm32-unknown-unknown \
  || rustup target add wasm32-unknown-unknown
# The crate pins wasm-bindgen; the CLI must match the crate exactly or it refuses.
command -v wasm-bindgen >/dev/null \
  || cargo install wasm-bindgen-cli --version 0.2.128

# Keep the path short: a deep Windows path overruns MAX_PATH and the host
# build scripts fail to link with LNK1104.
rm -rf "$work" && mkdir -p "$work" && cd "$work"
# ifcfast is public, so the tarball needs no auth. Prefer `gh` when it is
# present AND its token still works (a dead PAT gives 401, not a fallthrough),
# otherwise fetch it unauthenticated. Either way the bytes are the same.
repo="${IFCFAST_REPO:-EdvardGK/ifcfast}"
if command -v gh >/dev/null && gh api "repos/$repo/tarball/$rev" > src.tar.gz 2>/dev/null \
   && [ -s src.tar.gz ]; then
  echo "fetched $repo@$rev via gh"
else
  echo "gh unavailable or unauthorized; fetching $repo@$rev unauthenticated"
  curl -fsSL "https://api.github.com/repos/$repo/tarball/$rev" -o src.tar.gz
fi
tar xzf src.tar.gz && mv EdvardGK-ifcfast-* ifcfast && cd ifcfast

cargo build -p ifcfast-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/ifcfast_wasm.wasm

mkdir -p "$out" && cp pkg/* "$out/"
echo "vendored -> $out"
ls -la "$out"
