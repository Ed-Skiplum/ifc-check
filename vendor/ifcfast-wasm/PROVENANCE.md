# ifcfast-wasm — vendored build

Not authored here. Built from the ifcfast repository, which is read-only to this
project: https://github.com/EdvardGK/ifcfast

| | |
|---|---|
| Source | `crates/wasm` on branch `feat/wasm-type-objects-183` |
| Commit | `6a16c16fe287f9e25a91190625e6e7b2922c6d1c` |
| Crate version | 0.5.3 |
| Built with | wasm-bindgen 0.2.128 (pinned by the crate; a different CLI is refused) |
| Target | `wasm32-unknown-unknown`, `--release`, `--target web` |
| Built | 2026-09-23 |

The wasm crate is **not in any tagged release** — a release tarball carries
`crates/core` only. It exists on branches, and there is no published npm package
or release asset, so the module has to be built from source.
`scripts/build-wasm.sh` does that; `IFCFAST_REV` pins the commit and
`IFCFAST_REPO` the repository.

**The commit is a BRANCH HEAD, not ifcfast `main`.** `typeObjectsJson()` and the
per-product `type_guid` live on `feat/wasm-type-objects-183` and have not been
merged there. Rebuilding from `main` would silently lose both, and with them the
`type-unused` fundamental and the used/declared split on the Types KPI. Pin the
commit, or check that the branch has landed before moving to `main`.

## What 0.5.1 → 0.5.3 + this branch brought

New accessors, all of them MESH-FREE — the extractors run inside `fromBytes`, so
each call is a serialise and none of them triggers a tessellation pass:

| | |
|---|---|
| `psetsJson()` | `[{guid, pset_name, prop_name, value, value_type, source}]`. `guid` is the OWNER, which may be a product, a spatial element or the project. `source` is `instance` or `type` — type-inherited properties arrive keyed by the occurrence, instance winning a collision. |
| `classificationsJson()` | `[{guid, system_name, edition, identification, name, location, source, assignment_source}]`. `identification` is schema-normalised: IFC4 `.Identification` and IFC2x3 `.ItemReference` both land there. |
| `typeObjectsJson()` | `[{guid, entity, name, step_id}]` — every declared `IfcTypeObject`, keyed by the type's OWN GlobalId. Not `typesJson()`, whose `guid` is a representative occurrence's. |
| `quantitiesJson()` | authored `Qto_*` rows. Not wired into this app. |
| `materialsJson()` | the long layer table. Not wired into this app; `graphJson()`'s per-product name rollup is what the board reads. |
| `shiftJson()` | the global shift outside the mesh stream (ifcfast#188). |

`graphJson().products[]` also gained **`type_guid`**, which points into
`typeObjectsJson()`. Unused types are that roster minus the distinct non-null
`type_guid` — the one join this app could not make before.

Also in 0.5.1 → 0.5.3: `storeys[].elevation_m` (ifcfast#180, alongside the
file-unit `elevation` this code still reads via `unit_scale`),
`summary.skipped_product_types` (ifcfast#184), and ifcfast#190.

**Behaviour change worth knowing:** 0.5.3 parses `IfcGeographicElement`, which
0.5.1 dropped (ifcfast#178). KNM_RIV goes from 652 products to 653 — the extra
one is a `Site objekt`, and it is an orphan with no material that fails
`mesh-placement`, so several counts on that model move by one for reasons that
have nothing to do with the file.

**Spelling trap:** the type roster's `entity` is ifcfast's own title case —
`IfcWalltype`, not `IfcWallType` (ifcfast#186). Compare it case-insensitively;
never match it against a class name literally.

## Cost

Measured 2026-09-23 on the KNM Void-demo export (`01_inn/export_2026-09-14`),
this build, Node on the edkjo box. Payload is UTF-8 bytes of the returned string.

| model | parse | `psetsJson` | `classificationsJson` | `typeObjectsJson` |
|---|---|---|---|---|
| KNM_ARK (21.5 MB, 1 696 products) | 522 ms | 0.3 KiB / 0.9 ms (2 rows) | 383.0 KiB / 6.5 ms (1 424 rows) | 44.5 KiB / 1.2 ms (398 rows) |
| KNM_RIV (23.1 MB, 653 products) | 358 ms | 960.5 KiB / 11.6 ms (6 818 rows) | 0.0 KiB / 0.0 ms (0 rows) | 0.7 KiB / 0.0 ms (7 rows) |

So the three calls together cost **under 15 ms** on either model, against a
parse of a third of a second and a mesh pass of one to two seconds. The payload
is the thing to watch, not the time: `psetsJson` is the largest string this API
hands out, and it is why `CACHE_FORMAT` was bumped and `estimateBytes` grew
terms for the three tables.
