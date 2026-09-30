/**
 * The relay's selftest: the validator refuses anything that could carry
 * client data, the title and body match the app's own builder, dedupe and
 * rate limits behave, and the token never reaches a log line. Every accepted
 * report lands in the database first, without the client address; with no
 * token the relay runs log only, and `file-pending.mjs` files what is owed.
 * GitHub is a mock and the database a temp file under tmp/; nothing leaves
 * the process.
 *
 *   node relay/selftest.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBody, buildComment, buildTitle, createFiler, createRelay as relayWith, openStore, validate } from "./relay.mjs";
import { filePending } from "./file-pending.mjs";
import { issueBody, issueTitle } from "../src/engine/body-mesh.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, "..", "tmp", "relay-selftest");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/** The relay on an in-memory database unless a store is given. */
const createRelay = (options) => relayWith({ store: openStore(":memory:"), ...options });

const results = [];
const check = (name, expected, actual) => results.push({ name, ok: expected === actual, expected, actual });

const TOKEN = "github_pat_SELFTEST_never_logged_0123456789";
const ORIGIN = "https://ifc-check.skiplum.com";

const facts = () => ({
  signature: "IfcWallStandardCase / IfcExtrudedAreaSolid / ifcfast 0.5.3+6a16c16",
  elementClass: "IfcWallStandardCase",
  identifier: "Body",
  types: ["SweptSolid"],
  itemClasses: "IfcExtrudedAreaSolid",
  ifcfastVersion: "0.5.3+6a16c16",
  ifcopenshellVersion: "0.8.5",
  vertices: { min: 8, max: 16 },
  faces: { min: 12, max: 28 },
  inFile: 19,
  geometry: 19,
  none: 0,
  errors: 0,
});

/* ── the validator ──────────────────────────────────────────────────────── */

check("valid report accepted", true, validate(facts()).ok);
check(
  "mapped chain and (no Body) accepted",
  "true true",
  `${validate({ ...facts(), itemClasses: "IfcMappedItem>IfcFacetedBrep+IfcExtrudedAreaSolid, IfcBooleanClippingResult>IfcExtrudedAreaSolid", signature: "IfcWallStandardCase / IfcMappedItem>IfcFacetedBrep+IfcExtrudedAreaSolid, IfcBooleanClippingResult>IfcExtrudedAreaSolid / ifcfast 0.5.3+6a16c16" }).ok} ${validate({ ...facts(), identifier: "-", types: ["-"], itemClasses: "(no Body)", signature: "IfcWallStandardCase / (no Body) / ifcfast 0.5.3+6a16c16" }).ok}`,
);

const GUID = "2O2Fr$t4X7Zf8NOew3FLOH";
const hostile = {
  "extra key (fileName)": { ...facts(), fileName: "KNM_ARK_Kistefos.ifc" },
  "missing key": (() => {
    const f = facts();
    delete f.errors;
    return f;
  })(),
  "GUID as element class": { ...facts(), elementClass: GUID },
  "made-up class carrying a name": { ...facts(), elementClass: "IfcKistefosHall", signature: "IfcKistefosHall / IfcExtrudedAreaSolid / ifcfast 0.5.3+6a16c16" },
  "file name in the item chain": { ...facts(), itemClasses: "KNM_ARK_Kistefos.ifc" },
  "coordinates in the item chain": { ...facts(), itemClasses: "IfcCartesianPoint(1234.5,6789.0)" },
  "non-item class in the chain": { ...facts(), itemClasses: "IfcWall", signature: "IfcWallStandardCase / IfcWall / ifcfast 0.5.3+6a16c16" },
  "free text in a type": { ...facts(), types: ["Kistefos Hall 2"] },
  "unknown representation type": { ...facts(), types: ["Kistefos"] },
  "free text as identifier": { ...facts(), identifier: "Vegg A" },
  "free text in the ifcopenshell version": { ...facts(), ifcopenshellVersion: "0.8.5 Kistefos" },
  "GUID in the ifcfast version": { ...facts(), ifcfastVersion: GUID },
  "signature not rebuilt from its fields": { ...facts(), signature: `IfcWallStandardCase / IfcExtrudedAreaSolid / ifcfast 0.5.3+6a16c16 ${GUID}` },
  "count as a string": { ...facts(), inFile: "19" },
  "fractional count (a coordinate)": { ...facts(), vertices: { min: 8.25, max: 16 } },
  "extra key in a range": { ...facts(), faces: { min: 1, max: 2, x: 3 } },
  "no geometry: nothing ifcfast missed": { ...facts(), geometry: 0 },
  "counts exceed the elements": { ...facts(), geometry: 19, none: 5 },
  "array body": [facts()],
};
const accepted = Object.entries(hostile)
  .filter(([, body]) => validate(body).ok)
  .map(([name]) => name);
check("every hostile report refused", "none", accepted.length ? accepted.join("; ") : "none");

/* ── the title and body: the app's builder, byte for byte ───────────────── */

const noBody = { ...facts(), identifier: "-", types: ["-"], itemClasses: "(no Body)", signature: "IfcWallStandardCase / (no Body) / ifcfast 0.5.3+6a16c16" };
check(
  "title and body equal src/engine/body-mesh.ts",
  "true true true true",
  `${buildTitle(facts()) === issueTitle(facts())} ${buildBody(facts()) === issueBody(facts())} ${buildTitle(noBody) === issueTitle(noBody)} ${buildBody(noBody) === issueBody(noBody)}`,
);

/* ── a mock GitHub ──────────────────────────────────────────────────────── */

function mockGitHub({ issues = [], comments = {} } = {}) {
  const calls = [];
  const issued = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: u.pathname + u.search, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
    const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
    if (method === "GET" && u.pathname === "/search/issues") {
      const q = u.searchParams.get("q") ?? "";
      const phrase = /"(.*)"/.exec(q)?.[1] ?? "";
      // The search tokenises: a loose hit on the words, as the real one does.
      const words = phrase.split(/[^A-Za-z0-9]+/).filter(Boolean);
      return ok({ items: issues.filter((i) => words.every((w) => i.title.includes(w))) });
    }
    const one = /^\/repos\/EdvardGK\/ifcfast\/issues\/(\d+)$/.exec(u.pathname);
    if (method === "GET" && one) {
      const i = [...issues, ...issued].find((x) => x.number === Number(one[1]));
      return i ? ok({ ...i, comments: (comments[i.number] ?? []).length }) : ok({}, 404);
    }
    const list = /^\/repos\/EdvardGK\/ifcfast\/issues\/(\d+)\/comments$/.exec(u.pathname);
    if (list && method === "GET") return ok(comments[Number(list[1])] ?? []);
    if (list && method === "POST") return ok({ id: 1 }, 201);
    if (method === "POST" && u.pathname === "/repos/EdvardGK/ifcfast/issues") {
      // Created, but not yet in the search index (the mock's search reads
      // only the issues it was given).
      const created = { number: 99, html_url: "https://github.com/EdvardGK/ifcfast/issues/99" };
      issued.push({ ...created, title: JSON.parse(init.body).title, created_at: new Date(NOW).toISOString(), state: "open" });
      return ok(created, 201);
    }
    return ok({ message: "not mocked" }, 500);
  };
  return { fetch, calls };
}

const NOW = Date.parse("2026-09-30T12:00:00Z");
const request = (body, over = {}) => ({
  method: "POST",
  path: "/ifcfast-miss",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  ip: "10.0.0.1",
  body: JSON.stringify(body),
  ...over,
});
const sig = facts().signature;

{
  const gh = mockGitHub();
  const logs = [];
  const handle = createRelay({ token: TOKEN, fetch: gh.fetch, now: () => NOW, log: (l) => logs.push(l) });
  const out = await handle(request(facts()));
  const created = gh.calls.find((c) => c.method === "POST");
  check(
    "no open issue: created, with the built title and body",
    `200 created 99 | Body declared, no mesh: ${sig} | true`,
    `${out.status} ${out.json.action} ${out.json.number} | ${created?.body.title} | ${created?.body.body === issueBody(facts())}`,
  );
  check("token only in the Authorization header, never in a log line", "true false", `${gh.calls.every((c) => c.auth === `Bearer ${TOKEN}`)} ${logs.join("\n").includes(TOKEN)}`);
}

{
  // A loose search hit that does not carry the signature verbatim is not it.
  const gh = mockGitHub({ issues: [{ number: 3, title: `IfcWallStandardCase IfcExtrudedAreaSolid ifcfast 0.5.3+6a16c16 something else`, html_url: "u3", created_at: "2026-01-01T00:00:00Z", state: "open" }] });
  const out = await createRelay({ token: TOKEN, fetch: gh.fetch, now: () => NOW, log: () => {} })(request(facts()));
  check("a search hit without the verbatim signature is not a duplicate", "created", out.json.action);
}

{
  const open = { number: 7, title: `Body declared, no mesh: ${sig}`, html_url: "https://github.com/EdvardGK/ifcfast/issues/7", created_at: "2026-09-01T00:00:00Z", state: "open" };
  const old = mockGitHub({ issues: [open], comments: { 7: [{ body: "```text\nreports: 3\n```", created_at: "2026-09-27T00:00:00Z" }] } });
  const out = await createRelay({ token: TOKEN, fetch: old.fetch, now: () => NOW, log: () => {} })(request(facts()));
  const comment = old.calls.find((c) => c.method === "POST");
  check(
    "open issue, last comment 3 days old: a comment with the count incremented",
    `commented 7 | ${buildComment(facts(), 4) === comment?.body.body} | no new issue`,
    `${out.json.action} ${out.json.number} | ${comment?.path === "/repos/EdvardGK/ifcfast/issues/7/comments" && comment.body.body === buildComment(facts(), 4)} | ${old.calls.some((c) => c.method === "POST" && c.path === "/repos/EdvardGK/ifcfast/issues") ? "new issue" : "no new issue"}`,
  );

  const fresh = mockGitHub({ issues: [open], comments: { 7: [{ body: "```text\nreports: 3\n```", created_at: "2026-09-30T08:00:00Z" }] } });
  const skipped = await createRelay({ token: TOKEN, fetch: fresh.fetch, now: () => NOW, log: () => {} })(request(facts()));
  check(
    "open issue, last comment under 24 h: nothing written",
    "skipped 7 0",
    `${skipped.json.action} ${skipped.json.number} ${fresh.calls.filter((c) => c.method === "POST").length}`,
  );

  const bare = mockGitHub({ issues: [{ ...open, created_at: "2026-09-30T10:00:00Z" }] });
  const young = await createRelay({ token: TOKEN, fetch: bare.fetch, now: () => NOW, log: () => {} })(request(facts()));
  check("open issue with no comments, opened under 24 h ago: nothing written", "skipped", young.json.action);

  const twice = mockGitHub();
  const handle = createRelay({ token: TOKEN, fetch: twice.fetch, now: () => NOW, log: () => {} });
  await handle(request(facts()));
  const second = await handle(request(facts(), { ip: "10.0.0.2" }));
  check(
    "a second report right after creation finds the new issue despite the search lag",
    "skipped 99 1",
    `${second.json.action} ${second.json.number} ${twice.calls.filter((c) => c.method === "POST" && c.path === "/repos/EdvardGK/ifcfast/issues").length}`,
  );
}

/* ── limits, origins, sizes ─────────────────────────────────────────────── */

{
  const gh = mockGitHub();
  const handle = createRelay({ token: TOKEN, fetch: gh.fetch, now: () => NOW, log: () => {} });
  const statuses = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await handle(request(facts()))).status);
  check("11th report from one address within the hour: 429", "200x10 429", `${statuses.slice(0, 10).every((s) => s === 200) ? "200x10" : statuses.join(",")} ${statuses[10]}`);

  const daily = createRelay({ token: TOKEN, fetch: mockGitHub().fetch, now: () => NOW, log: () => {} });
  let last = 0;
  for (let i = 0; i < 51; i += 1) last = (await daily(request(facts(), { ip: `10.1.${Math.floor(i / 5)}.${i % 5}` }))).status;
  check("51st report in a day, across addresses: 429", "429", String(last));
}

{
  const gh = mockGitHub();
  const handle = createRelay({ token: TOKEN, fetch: gh.fetch, now: () => NOW, log: () => {} });
  const foreign = await handle(request(facts(), { headers: { origin: "https://evil.example", "content-type": "application/json" } }));
  const preflight = await handle({ method: "OPTIONS", path: "/relay/ifcfast-miss", headers: { origin: ORIGIN }, ip: "1", body: "" });
  const foreignPreflight = await handle({ method: "OPTIONS", path: "/ifcfast-miss", headers: { origin: "http://localhost:5173" }, ip: "1", body: "" });
  const big = await handle(request(facts(), { body: JSON.stringify({ ...facts(), pad: "x".repeat(5000) }) }));
  const text = await handle(request(facts(), { headers: { origin: ORIGIN, "content-type": "text/plain" } }));
  const invalid = await handle(request({ ...facts(), fileName: "a.ifc" }));
  check(
    "foreign origin 403, allowed preflight 204 with its origin, foreign preflight 403, 5 KB 413, text/plain 415, invalid 422, none reached GitHub",
    `403 204 ${ORIGIN} 403 413 415 422 0`,
    `${foreign.status} ${preflight.status} ${preflight.headers["Access-Control-Allow-Origin"]} ${foreignPreflight.status} ${big.status} ${text.status} ${invalid.status} ${gh.calls.length}`,
  );
}

{
  const failing = { fetch: async () => ({ ok: false, status: 401, json: async () => ({ message: `bad credentials ${TOKEN}` }) }) };
  const logs = [];
  const store = openStore(":memory:");
  const out = await createRelay({ store, token: TOKEN, fetch: failing.fetch, now: () => NOW, log: (l) => logs.push(l) })(request(facts()));
  const row = store.owed()[0];
  check(
    "GitHub refusing: 202 logged with the status only, the row stays pending, the failure an event, nothing echoed",
    "202 logged github 401 pending failed:github 401 false",
    `${out.status} ${out.json.action} ${out.json.error} ${row?.status} ${store.events(row?.id).map((e) => `${e.outcome}:${e.detail}`).join()} ${JSON.stringify(out).includes(TOKEN) || logs.join().includes(TOKEN)}`,
  );
}

{
  const store = openStore(":memory:");
  const out = await createRelay({ store, token: TOKEN, fetch: mockGitHub().fetch, now: () => NOW, log: () => {} })(request(facts()));
  const row = store.row(1);
  check(
    "with a token: recorded, then filed, the outcome on the row and as an event",
    "200 created | filed 99 https://github.com/EdvardGK/ifcfast/issues/99 | created",
    `${out.status} ${out.json.action} | ${row?.status} ${row?.issue_number} ${row?.issue_url} | ${store.events(1).map((e) => e.outcome).join()}`,
  );
}

/* ── the database: log only, the listing, no address ────────────────────── */

const IP = "203.0.113.77";
const DB = join(TMP, "ifc-check.db");

{
  const store = openStore(DB);
  let githubCalls = 0;
  const handle = relayWith({ store, fetch: async () => (githubCalls += 1), now: () => NOW, log: () => {} });
  const first = await handle(request(facts(), { ip: IP }));
  const second = await handle(request({ ...facts(), inFile: 21, geometry: 20 }, { ip: IP }));
  const refused = await handle(request({ ...facts(), fileName: "KNM_ARK_Kistefos.ifc" }, { ip: IP }));
  const rows = store.owed();
  check(
    "no token: starts log only, 202 logged, one row per signature with the count bumped, the latest numbers, no GitHub call",
    "202 logged pending 1 | 202 2 | 1 row pending 2 in_file 21 | 422 | 0",
    `${first.status} ${first.json.action} ${first.json.status} ${first.json.reports} | ${second.status} ${second.json.reports} | ${rows.length} row ${rows[0]?.status} ${rows[0]?.reports} in_file ${rows[0]?.in_file} | ${refused.status} | ${githubCalls}`,
  );
  check(
    "the stored row holds the validated fields and the bookkeeping, nothing else",
    "element_class errors faces_max faces_min first_seen geometry id identifier ifcfast_version ifcopenshell_version in_file issue_number issue_url item_classes last_seen none_count reports signature status types vertices_max vertices_min",
    Object.keys(rows[0] ?? {}).sort().join(" "),
  );

  const listing = await handle({ method: "GET", path: "/relay/ifcfast-miss", headers: { origin: ORIGIN }, ip: IP, body: "" });
  const entry = listing.json.misses?.[0];
  check(
    "GET /ifcfast-miss lists signature, counts, status, issue; nothing more",
    `200 ${ORIGIN} 1 | ${sig} 2 pending null | firstSeen issueNumber issueUrl lastSeen reports signature status`,
    `${listing.status} ${listing.headers["Access-Control-Allow-Origin"]} ${listing.json.misses?.length} | ${entry?.signature} ${entry?.reports} ${entry?.status} ${entry?.issueNumber} | ${Object.keys(entry ?? {}).sort().join(" ")}`,
  );
  store.close();

  const bytes = readdirSync(TMP)
    .filter((f) => f.startsWith("ifc-check.db"))
    .map((f) => readFileSync(join(TMP, f)).toString("latin1"))
    .join("");
  check("the database file holds the report and never the client address", "true false", `${bytes.includes(sig)} ${bytes.includes(IP)}`);
}

/* ── file-pending: dry run, then filing against the mock ────────────────── */

{
  const seed = openStore(DB);
  const slab = "IfcSlab / IfcExtrudedAreaSolid / ifcfast 0.5.3+6a16c16";
  const seeded = seed.record({ ...facts(), elementClass: "IfcSlab", signature: slab }, new Date(NOW).toISOString());
  seed.close();

  // The CLI itself, with no token and GitHub pointed at a closed port: a dry
  // run needs neither.
  const out = execFileSync(process.execPath, [join(HERE, "file-pending.mjs"), "--dry-run"], {
    env: { ...process.env, RELAY_DB: DB, IFCFAST_ISSUES_TOKEN: "", GITHUB_API: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  const store = openStore(DB);
  check(
    "--dry-run: lists both owed signatures, files nothing, writes nothing",
    "2 | pending pending | 0 0",
    `${(out.match(/^would file: /gm) ?? []).length} | ${store.owed().map((r) => r.status).join(" ")} | ${store.events(1).length} ${store.events(seeded.id).length}`,
  );

  // The wall has an open issue, last touched 3 days ago; the slab has none.
  const open = { number: 7, title: `Body declared, no mesh: ${sig}`, html_url: "https://github.com/EdvardGK/ifcfast/issues/7", created_at: "2026-09-01T00:00:00Z", state: "open" };
  const gh = mockGitHub({ issues: [open], comments: { 7: [{ body: "```text\nreports: 3\n```", created_at: "2026-09-27T00:00:00Z" }] } });
  const slept = [];
  const outcomes = await filePending({
    store,
    filer: createFiler({ token: TOKEN, fetch: gh.fetch, now: () => NOW }),
    now: () => NOW,
    print: () => {},
    sleep: async (ms) => slept.push(ms),
  });
  const bySig = Object.fromEntries(store.list().map((r) => [r.signature, r]));
  check(
    "pending to filed: the open issue commented, the new one created, one pause between them, events recorded",
    "commented 7, created 99 | filed 7 filed 99 | 3000 | commented created | 0 owed",
    `${outcomes.map((o) => `${o.action} ${o.number}`).join(", ")} | ${bySig[sig]?.status} ${bySig[sig]?.issueNumber} ${bySig[slab]?.status} ${bySig[slab]?.issueNumber} | ${slept.join(",")} | ${[...store.events(1), ...store.events(seeded.id)].map((e) => e.outcome).join(" ")} | ${store.owed().length} owed`,
  );

  // A repeat report of a filed signature is owed again, and the relay's
  // answer carries the issue the row already has.
  const handle = relayWith({ store, now: () => NOW, log: () => {} });
  const repeat = await handle(request(facts(), { ip: "10.9.9.9" }));
  check("a repeat report of a filed signature: 202 logged with its issue, owed again", "202 logged 7 pending", `${repeat.status} ${repeat.json.action} ${repeat.json.number} ${repeat.json.status}`);

  const refusing = { fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) };
  const failedRun = await filePending({ store, filer: createFiler({ token: TOKEN, fetch: refusing.fetch }), print: () => {}, sleep: async () => {} });
  check(
    "GitHub refusing file-pending: the row marked failed and still owed",
    "failed github 401 | failed 1",
    `${failedRun.map((o) => `${o.action} ${o.detail}`).join()} | ${store.owed().map((r) => r.status).join()} ${store.owed().length}`,
  );
  store.close();
}

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ command: "relay selftest", ok: failed.length === 0, assertions: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
