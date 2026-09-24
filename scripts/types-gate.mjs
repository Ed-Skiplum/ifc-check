/** Headless proof of the TYPE LEDGER against a real file.
 *
 * It drives the SHIPPED modules — `profileOf`, `withTypeFacts` and
 * `aggregateTypes` — in the same order `src/ui/model-worker.ts` drives them,
 * and streams the real mesh pass so the geometry columns are the same numbers
 * the tile shows. No second copy of the aggregation lives here: a gate that
 * reimplements what it checks proves only that two of my mistakes agree.
 *
 * Asserted, all against the file rather than against a fixture:
 *   1  the ledger's instance counts sum to the products it looked at
 *   2  every product appears in exactly one row (no double-count, no drop)
 *   3  `singles / types` is the SAME arithmetic `single-instance-types` prints
 *      in the verification block — the two numbers are on one screen and may
 *      never disagree
 *   4  a meshed count never exceeds its row's instance count
 *   5  a row with no type facts is reported as absent, never as "untyped"
 *   6  the three "types" numbers reconcile — declared type objects, used type
 *      objects and distinct type NAMES — and `type-unused` counts exactly the
 *      gap between the first two
 *
 * Run:  node scripts/types-gate.mjs <model.ifc> [...]
 * Exit: 0 every assertion holds, 1 an assertion failed, 2 usage/internal.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { initSync, IfcModel } from "../vendor/ifcfast-wasm/ifcfast_wasm.js";
import { runFundamentals } from "../src/engine/fundamentals.ts";
import { profileOf } from "../src/storage/rehydrate.ts";
import { withTypeFacts } from "../src/ui/types/facts.ts";
import { aggregateTypes, meshIndex, TYPE_BUCKETS, TYPE_HEALTH_BANDS } from "../src/ui/types/aggregate.ts";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: node scripts/types-gate.mjs <model.ifc> [...]");
  process.exit(2);
}

initSync({
  module: readFileSync(new URL("../vendor/ifcfast-wasm/ifcfast_wasm_bg.wasm", import.meta.url)),
});

const BUCKET_LABEL = ["1", "2-4", "5-9", "10+"];
let failed = false;

function check(ok, message) {
  if (ok) return;
  failed = true;
  console.log(`   FAIL  ${message}`);
}

function pct(part, total) {
  return total > 0 ? `${((part / total) * 100).toFixed(0)} %` : "—";
}

/** `flag` off = the untyped remainder, where a spread is not a fault. */
function declaredText(declared, flag = true) {
  if (declared.variants > 1 && flag) return `! ${declared.variants} variants`;
  if (declared.values.length === 0) return "—";
  const joined = declared.values.join(" · ");
  return joined.length > 34 ? `${joined.slice(0, 33)}…` : joined;
}

for (const path of paths) {
  const bytes = readFileSync(path);
  const name = basename(path);

  const model = IfcModel.fromBytes(new Uint8Array(bytes), name);
  const summary = JSON.parse(model.summaryJson());

  // Geometry first, then the graph — the worker's order, and the one that
  // costs a single tessellation pass instead of two.
  const batches = [];
  let batchNumber = 0;
  model.streamMeshes(250, (metaJson, positions, indices) => {
    batches.push({ batch: batchNumber++, meta: JSON.parse(metaJson), positions, indices });
  });

  const graph = JSON.parse(model.graphJson());
  // The declared type roster, attached exactly as the parse worker attaches it.
  // Without it `type-unused` reports "not supplied" and the ledger's foot has
  // no denominator — a gate that drives a different model shape from the app
  // proves the wrong thing.
  graph.type_objects = JSON.parse(model.typeObjectsJson());
  graph.psets = JSON.parse(model.psetsJson());
  graph.classifications = JSON.parse(model.classificationsJson());
  graph.quantities = JSON.parse(model.quantitiesJson());
  model.free();

  const checks = runFundamentals(graph, summary);
  const bare = profileOf(graph);
  const profile = withTypeFacts(bare, graph);
  const ledger = aggregateTypes(profile, {
    mesh: meshIndex(batches),
    meshCapped: false,
    typeObjectsDeclared: summary.tables?.type_objects?.rows ?? null,
  });

  console.log(
    `\n=== ${name} | ${summary.schema} | ${(bytes.length / 1e6).toFixed(1)} MB | ` +
      `${summary.products} products ===`,
  );
  console.log(
    `   type objects ${ledger.typeObjectsUsed} used of ${ledger.typeObjectsDeclared} declared ` +
      `· ${ledger.types} distinct names`,
  );
  console.log(
    `   types ${ledger.types} · single-instance ${ledger.singles} (${pct(
      ledger.singles,
      ledger.types,
    )}) · band ${ledger.health ?? "n/a"} · our thresholds >= ${Math.round(
      TYPE_HEALTH_BANDS.watch * 100,
    )} % / >= ${Math.round(TYPE_HEALTH_BANDS.weak * 100)} %`,
  );
  console.log(
    `   instances per type: ` +
      TYPE_BUCKETS.map((_b, i) => `${BUCKET_LABEL[i]}=${ledger.buckets[i]}`).join("  ") +
      `  · median ${ledger.median ?? "—"}`,
  );
  console.log(
    `   untyped ${ledger.untyped} of ${ledger.products} products · ` +
      `type facts ${ledger.factsPresent ? "present" : "ABSENT"} · ` +
      `geometry ${ledger.meshUnknown ? "not read" : "read"}`,
  );

  // The table, exactly the columns the tile prints.
  const head =
    `   ${"TYPE".padEnd(30)}${"CLASS".padEnd(22)}${"INST".padStart(6)}` +
    `${"GEOM".padStart(10)}${"TRI".padStart(10)}  ${"PREDEFINED".padEnd(18)}${"MATERIALS".padEnd(34)}PROPS`;
  console.log(head);
  const shown = ledger.rows.slice(0, 12);
  for (const row of shown) {
    const label = row.typeName ?? "(untyped)";
    const flag = row.typeName !== null;
    const klass =
      row.classes.length > 1
        ? `${flag ? "! " : ""}${row.classes.length}: ${row.classes.map((c) => c.entity).join(",")}`
        : (row.classes[0]?.entity ?? "—");
    const geom = row.meshed === null ? "—" : `${row.meshed}/${row.instances}`;
    const tri = row.triangles === null ? "—" : String(row.triangles);
    const props = [
      ["IsExternal", row.isExternal],
      ["FireRating", row.fireRating],
      ["LoadBearing", row.loadBearing],
    ]
      .filter(([, d]) => d.values.length > 0 || (d.variants > 1 && flag))
      .map(([n, d]) => `${n}=${declaredText(d, flag)}`)
      .join(" ");
    console.log(
      `   ${label.slice(0, 29).padEnd(30)}${klass.slice(0, 21).padEnd(22)}` +
        `${String(row.instances).padStart(6)}${geom.padStart(10)}${tri.padStart(10)}  ` +
        `${declaredText(row.predefined, flag).slice(0, 17).padEnd(18)}` +
        `${declaredText(row.materials, flag).slice(0, 33).padEnd(34)}${props || "—"}`,
    );
  }
  if (ledger.rows.length > shown.length) {
    console.log(`   ... ${ledger.rows.length - shown.length} more row(s)`);
  }

  // ── assertions ──────────────────────────────────────────────────────────
  const openings = new Set(graph.voids.map((v) => v.opening_guid));
  const physical = graph.products.filter((p) => !openings.has(p.guid));

  const summed = ledger.rows.reduce((total, row) => total + row.instances, 0);
  check(
    summed === physical.length,
    `rows sum to ${summed}, the file carries ${physical.length} non-opening products`,
  );

  const seen = new Set();
  let duplicated = 0;
  for (const row of ledger.rows) {
    for (const guid of row.guids) {
      if (seen.has(guid)) duplicated += 1;
      seen.add(guid);
    }
  }
  check(duplicated === 0, `${duplicated} product(s) appear in more than one row`);
  check(
    seen.size === physical.length,
    `${seen.size} distinct products across the rows, expected ${physical.length}`,
  );

  // The same numbers the focal prints. `single-instance-types` is `review` with
  // `applicable` = distinct types and one finding per single-instance type.
  const single = checks.find((c) => c.id === "single-instance-types");
  check(
    single !== undefined && single.applicable === ledger.types,
    `check says ${single?.applicable} types, ledger says ${ledger.types}`,
  );
  check(
    single !== undefined && single.findings.length === ledger.singles,
    `check says ${single?.findings.length} single-instance types, ledger says ${ledger.singles}`,
  );

  // The THREE "types" numbers on one board must reconcile, because they are on
  // one screen: the KPI prints used/declared, this table lists names, and
  // `type-unused` counts the gap. They were derived independently before the
  // roster was readable and could not be checked against each other at all.
  const declaredRoster = graph.type_objects?.length ?? null;
  const usedRoster = new Set(
    graph.products.map((row) => row.type_guid).filter((guid) => guid != null),
  ).size;
  check(
    ledger.typeObjectsDeclared === declaredRoster,
    `ledger declares ${ledger.typeObjectsDeclared} type objects, the roster has ${declaredRoster}`,
  );
  check(
    ledger.typeObjectsUsed === usedRoster,
    `ledger says ${ledger.typeObjectsUsed} type objects used, the products point at ${usedRoster}`,
  );
  const unused = checks.find((c) => c.id === "type-unused");
  const expectedUnused = declaredRoster === null ? null : declaredRoster - usedRoster;
  check(
    unused !== undefined &&
      (declaredRoster === 0
        ? unused.state === "not_applicable"
        : unused.findings.length === expectedUnused),
    `type-unused reports ${unused?.findings.length} unused, declared minus used is ${expectedUnused}`,
  );
  check(
    ledger.types <= usedRoster,
    `${ledger.types} distinct type names over ${usedRoster} used type objects — names cannot exceed objects`,
  );

  for (const row of ledger.rows) {
    if (row.meshed === null) continue;
    check(
      row.meshed <= row.instances,
      `"${row.typeName ?? "(untyped)"}" reports ${row.meshed} meshed of ${row.instances}`,
    );
  }

  // The plumbing case: a profile that never saw `withTypeFacts` must come back
  // as ABSENT, never as a model in which everything is untyped. A file the
  // parser reduced to ZERO products cannot distinguish the two and is not
  // asked to — `parse-integrity` already fails loudly on it.
  if (bare.rows.length > 0) {
    const naive = aggregateTypes(bare, { mesh: null, meshCapped: false });
    check(naive.factsPresent === false, "a profile without type facts reported them present");
    check(naive.rows.length === 0 && naive.types === 0, "a profile without type facts produced rows");
  }

  console.log(`   assertions: ${failed ? "FAILED" : "all hold"}`);
}

process.exit(failed ? 1 : 0);
