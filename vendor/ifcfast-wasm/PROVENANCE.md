# ifcfast-wasm — vendored build

Not authored here. Built from the ifcfast repository, which is read-only to this
project: https://github.com/EdvardGK/ifcfast

| | |
|---|---|
| Source | `crates/wasm` on `main` |
| Commit | `45f45621e54e79fe99dc96721576034f4c0dd5a9` |
| Crate version | 0.5.1 |
| Built with | wasm-bindgen 0.2.128 (pinned by the crate; a different CLI is refused) |
| Target | `wasm32-unknown-unknown`, `--release`, `--target web` |

The wasm crate is **not in any tagged release** — v0.5.1's tarball contains only
`crates/core`. It exists on `main` only, and there is no published npm package
or release asset, so the module has to be built from source. `scripts/build-wasm.sh`
does that.

Rebuild when ifcfast `main` moves, in particular for
[#183](https://github.com/EdvardGK/ifcfast/issues/183) (pset and classification
accessors), which the IDS property and classification facets depend on.
