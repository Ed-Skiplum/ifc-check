/**
 * The relay's selftest: the validator refuses anything that could carry
 * client data, the title and body match the app's own builder, dedupe and
 * rate limits behave, and the token never reaches a log line. Every accepted
 * report lands in the database first, without the client address; with no
 * token the relay runs log only, and `file-pending.mjs` files what is owed.
 * Shares: stored as sent, served with their type and the CSP sandbox, every
 * bad type, name and size refused without reading further than needed,
 * deleted only with the token, expired at 180 days; then the same over a
 * real HTTP server on a loopback port. GitHub is a mock and the databases
 * temp files under tmp/; nothing leaves the machine.
 *
 *   node relay/selftest.mjs
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBody, buildComment, buildTitle, createFiler, createRelay as relayWith, openStore, serve, validate } from "./relay.mjs";
import { createShareHandler, openShares } from "./share.mjs";
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
const HOUR_MS = 60 * 60 * 1000;
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

/* ── shares: the report files, stored, served sandboxed, deleted, expired ── */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SHARE_DB = join(TMP, "shares.db");
const SHARE_DIR = join(TMP, "shares");
const reportFiles = () => [
  { name: "rapport.html", type: "text/html", data: Buffer.from("<!doctype html><title>r</title><script>localStorage.x=1</script>æøå") },
  { name: "rapport.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.7\n%selftest\n") },
  { name: "rapport.xlsx", type: XLSX, data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]) },
  { name: "funn.csv", type: "text/csv", data: Buffer.from("a;b\n1;2\n") },
  { name: "funn.json", type: "application/json", data: Buffer.from('{"ok":true}') },
];
/** The wire format: the manifest line, then the bytes back to back. */
const shareBody = (files, manifest = { files: files.map((f) => ({ name: f.name, type: f.type, size: f.data.length })) }) =>
  Buffer.concat([Buffer.from(JSON.stringify(manifest) + "\n"), ...files.map((f) => f.data)]);
/** Split into small chunks, so manifest and file boundaries fall mid-chunk;
 *  `pulled` counts how much of it the handler asked for. */
function chunked(buf, size = 7) {
  const state = { pulled: 0, total: Math.ceil(buf.length / size) };
  state.stream = (async function* () {
    for (let i = 0; i < buf.length; i += size) {
      state.pulled += 1;
      yield buf.subarray(i, i + size);
    }
  })();
  return state;
}
const post = (body, over = {}) => {
  const c = chunked(body, over.chunk ?? 7);
  return {
    c,
    request: {
      method: "POST",
      path: "/relay/share",
      headers: { origin: ORIGIN, "content-type": "application/octet-stream", "content-length": String(body.length), ...over.headers },
      ip: over.ip ?? "10.2.0.1",
      body: "",
      stream: c.stream,
    },
  };
};
const get = (path, headers = {}) => ({ method: "GET", path, headers, ip: "10.3.0.1", body: "" });
const CSP = "sandbox allow-scripts allow-popups allow-downloads";
const guarded = (h) => h["Content-Security-Policy"] === CSP && h["X-Content-Type-Options"] === "nosniff" && h["Referrer-Policy"] === "no-referrer" && !("X-Frame-Options" in h);
const leftovers = () => readdirSync(SHARE_DIR).filter((e) => e.endsWith(".part")).length;

let clock = NOW;
const shareLogs = [];
const shares = openShares(SHARE_DB, SHARE_DIR);
const shareWith = (opts = {}) =>
  relayWith({
    store: openStore(":memory:"),
    share: createShareHandler({ shares, origins: [ORIGIN], now: () => clock, log: (l) => shareLogs.push(l), ...opts }),
    now: () => clock,
    log: () => {},
  });

{
  const handle = shareWith();
  const files = reportFiles();
  const made = await handle(post(shareBody(files), { ip: IP }).request);
  const { id, deleteToken, urls } = made.json ?? {};
  check(
    "POST /share: 201 with a 22-character id, a separate token, a link per file; CORS to the app's origin; guarded",
    `201 true true ${files.map((f) => f.name).join(",")} true ${ORIGIN} true`,
    `${made.status} ${/^[A-Za-z0-9_-]{22}$/.test(id ?? "")} ${typeof deleteToken === "string" && deleteToken.length >= 43 && deleteToken !== id} ${Object.keys(urls ?? {}).join(",")} ${urls?.["rapport.html"] === `https://ifc-check.skiplum.com/relay/share/${id}/rapport.html`} ${made.headers["Access-Control-Allow-Origin"]} ${guarded(made.headers)}`,
  );

  const served = [];
  for (const f of files) {
    const out = await handle(get(`/relay/share/${id}/${f.name}`, { origin: "https://elsewhere.example" }));
    const bytes = out.file ? readFileSync(out.file) : null;
    served.push(
      `${f.name}:${out.status} ${out.headers["Content-Type"]} ${out.headers["Content-Disposition"]?.split(";")[0]} ${out.headers["Access-Control-Allow-Origin"]} ${guarded(out.headers)} ${bytes?.equals(f.data)} ${out.headers["Content-Length"] === String(f.data.length)}`,
    );
  }
  check(
    "GET each type: its stored type, inline for html/json, attachment for pdf/xlsx/csv, any origin, the CSP sandbox and nosniff, no X-Frame-Options, the bytes as sent",
    [
      "rapport.html:200 text/html; charset=utf-8 inline * true true true",
      "rapport.pdf:200 application/pdf attachment * true true true",
      `rapport.xlsx:200 ${XLSX} attachment * true true true`,
      "funn.csv:200 text/csv; charset=utf-8 attachment * true true true",
      "funn.json:200 application/json; charset=utf-8 inline * true true true",
    ].join(" | "),
    served.join(" | "),
  );

  const misses = await Promise.all(
    [
      `/share/${id.slice(0, 21)}A/rapport.html`,
      `/share/${id}/annet.html`,
      `/share/${id}/..%2Fshares.db`,
      `/share/${id}/0`,
      `/share/${id}`,
      `/share`,
      `/relay/share/`,
    ].map((p) => handle(get(p))),
  );
  check(
    "unknown id, unknown name, traversal, the on-disk name, and every listing attempt: a plain 404, guarded",
    "404 404 404 404 404 404 404 true",
    `${misses.map((m) => m.status).join(" ")} ${misses.every((m) => guarded(m.headers))}`,
  );

  const wrong = await handle({ method: "DELETE", path: `/relay/share/${id}`, headers: { origin: ORIGIN, "x-delete-token": "nope" }, ip: IP, body: "" });
  const none = await handle({ method: "DELETE", path: `/relay/share/${id}`, headers: { origin: ORIGIN }, ip: IP, body: "" });
  const foreign = await handle({ method: "DELETE", path: `/relay/share/${id}`, headers: { origin: "https://evil.example", "x-delete-token": deleteToken }, ip: IP, body: "" });
  const still = await handle(get(`/share/${id}/rapport.pdf`));
  const preflight = await handle({ method: "OPTIONS", path: `/relay/share/${id}`, headers: { origin: ORIGIN }, ip: IP, body: "" });
  check(
    "DELETE with a wrong or no token 403, from a foreign origin 403, the share still served; preflight allows X-Delete-Token",
    "403 403 403 200 204 true",
    `${wrong.status} ${none.status} ${foreign.status} ${still.status} ${preflight.status} ${preflight.headers["Access-Control-Allow-Headers"]?.includes("X-Delete-Token")}`,
  );

  // The database: names, sizes and the token's hash; never the token, the
  // client address or the content.
  const dbBytes = readdirSync(TMP)
    .filter((f) => f.startsWith("shares.db"))
    .map((f) => readFileSync(join(TMP, f)).toString("latin1"))
    .join("");
  check(
    "the database holds the names and the token's hash, never the token, the address or the content",
    "true true false false false",
    `${dbBytes.includes("rapport.html")} ${dbBytes.includes(createHash("sha256").update(deleteToken).digest("hex"))} ${dbBytes.includes(deleteToken)} ${dbBytes.includes(IP)} ${dbBytes.includes("localStorage.x")}`,
  );

  const gone = await handle({ method: "DELETE", path: `/share/${id}`, headers: { "x-delete-token": deleteToken }, ip: IP, body: "" });
  const after = await handle(get(`/share/${id}/rapport.html`));
  const again = await handle({ method: "DELETE", path: `/share/${id}`, headers: { "x-delete-token": deleteToken }, ip: IP, body: "" });
  check(
    "DELETE with the right token (no Origin, as curl): 204, then 404, its files off the disk, a second delete 404",
    "204 404 false 404",
    `${gone.status} ${after.status} ${readdirSync(SHARE_DIR).includes(id)} ${again.status}`,
  );
  check(
    "share log lines carry neither ids, tokens nor the address",
    "false",
    String(shareLogs.some((l) => l.includes(id) || l.includes(deleteToken) || l.includes(IP))),
  );
}

{
  const handle = shareWith();
  const ok = reportFiles().slice(0, 1);
  const refusals = {
    "type not allowed": [shareBody([{ name: "x.js", type: "text/javascript", data: Buffer.from("1") }]), 422],
    "slash in the name": [shareBody([{ name: "a/b.html", type: "text/html", data: Buffer.from("1") }]), 422],
    "dot-dot in the name": [shareBody([{ name: "a..html", type: "text/html", data: Buffer.from("1") }]), 422],
    "leading dot": [shareBody([{ name: ".x.html", type: "text/html", data: Buffer.from("1") }]), 422],
    "non-ASCII name": [shareBody([{ name: "rapport-æ.html", type: "text/html", data: Buffer.from("1") }]), 422],
    "name of 101 characters": [shareBody([{ name: `${"a".repeat(96)}.html`, type: "text/html", data: Buffer.from("1") }]), 422],
    "extension not the type's": [shareBody([{ name: "rapport.html", type: "application/pdf", data: Buffer.from("1") }]), 422],
    "duplicate name": [shareBody([...ok, { ...ok[0], name: "RAPPORT.html" }]), 422],
    "extra key": [shareBody(ok, { files: [{ name: "rapport.html", type: "text/html", size: ok[0].data.length, path: "/etc" }] }), 422],
    "nine files": [shareBody(Array.from({ length: 9 }, (_, i) => ({ name: `r${i}.csv`, type: "text/csv", data: Buffer.from("1") }))), 422],
    "empty file": [shareBody([{ name: "r.csv", type: "text/csv", data: Buffer.alloc(0) }]), 422],
    "not JSON": [Buffer.from("files=1\nxx"), 400],
    "fewer bytes than declared": [shareBody(ok, { files: [{ name: "rapport.html", type: "text/html", size: ok[0].data.length + 5 }] }), 400],
  };
  const statuses = [];
  for (const [name, [body, want]] of Object.entries(refusals)) {
    const out = await handle(post(body).request);
    if (out.status !== want || !guarded(out.headers)) statuses.push(`${name}: ${out.status}`);
  }
  check("bad type, name, extension, keys, count, JSON or length: refused, guarded, nothing stored", "none | 0", `${statuses.join("; ") || "none"} | ${leftovers()}`);

  // Declared over the caps: refused on the manifest, before a byte of content.
  const fileCap = post(shareBody([{ name: "big.pdf", type: "application/pdf", data: Buffer.alloc(16) }], { files: [{ name: "big.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 }] }), { chunk: 8192 });
  const fileOut = await handle(fileCap.request);
  const shareCap = post(
    shareBody([], { files: [0, 1, 2].map((i) => ({ name: `r${i}.pdf`, type: "application/pdf", size: 4.5 * 1024 * 1024 })) }),
    { chunk: 8192 },
  );
  const shareOut = await handle(shareCap.request);
  const declaredLong = post(shareBody(ok), { headers: { "content-length": String(13 * 1024 * 1024) } });
  const longOut = await handle(declaredLong.request);
  // One byte past the manifest's sizes, in the first chunk after: the upload
  // ends there, the rest of a 1 MB tail never read.
  const trailing = post(Buffer.concat([shareBody(ok), Buffer.alloc(1024 * 1024)]), { chunk: 1024 });
  const trailOut = await handle(trailing.request);
  const hugeManifest = post(Buffer.from(`{"files":[${'"x",'.repeat(2000)}]}\n`), { chunk: 1024 });
  const manOut = await handle(hugeManifest.request);
  check(
    "over 5 MB a file, 12 MB a share, a too-long Content-Length, bytes past the manifest, a manifest over 4 KB: 413, read no further than needed",
    "413/1 413/1 413/0 413 early 413/5 | 0",
    `${fileOut.status}/${fileCap.c.pulled} ${shareOut.status}/${shareCap.c.pulled} ${longOut.status}/${declaredLong.c.pulled} ${trailOut.status} ${trailing.c.pulled < 10 ? "early" : `read ${trailing.c.pulled}/${trailing.c.total}`} ${manOut.status}/${hugeManifest.c.pulled} | ${leftovers()}`,
  );

  const foreign = await handle(post(shareBody(ok), { headers: { origin: "https://evil.example" } }).request);
  const noOrigin = await handle(post(shareBody(ok), { headers: { origin: undefined } }).request);
  const foreignPre = await handle({ method: "OPTIONS", path: "/relay/share", headers: { origin: "http://localhost:5173" }, ip: "1", body: "" });
  const pre = await handle({ method: "OPTIONS", path: "/relay/share", headers: { origin: ORIGIN }, ip: "1", body: "" });
  const text = await handle(post(shareBody(ok), { headers: { "content-type": "application/json" } }).request);
  check(
    "POST from a foreign origin or none 403, foreign preflight 403, the app's preflight 204, a JSON body 415",
    `403 undefined 403 403 204 ${ORIGIN} 415`,
    `${foreign.status} ${foreign.headers["Access-Control-Allow-Origin"]} ${noOrigin.status} ${foreignPre.status} ${pre.status} ${pre.headers["Access-Control-Allow-Origin"]} ${text.status}`,
  );
}

{
  const handle = shareWith();
  const statuses = [];
  for (let i = 0; i < 21; i += 1) statuses.push((await handle(post(shareBody(reportFiles().slice(3, 4)), { ip: "10.4.0.1" }).request)).status);
  const daily = shareWith({ perDay: 3 });
  const days = [];
  for (let i = 0; i < 4; i += 1) days.push((await daily(post(shareBody(reportFiles().slice(3, 4)), { ip: `10.5.0.${i}` }).request)).status);
  const full = shareWith({ storeMax: shares.used() + 10 });
  const fits = await full(post(shareBody([{ name: "a.csv", type: "text/csv", data: Buffer.from("123456789") }])).request);
  const over = await full(post(shareBody([{ name: "a.csv", type: "text/csv", data: Buffer.from("12") }])).request);
  check(
    "21st share from one address within the hour 429; past the daily cap 429; past the store cap 507",
    "201x20 429 | 201 201 201 429 | 201 507 store full",
    `${statuses.slice(0, 20).every((s) => s === 201) ? "201x20" : statuses.join(",")} ${statuses[20]} | ${days.join(" ")} | ${fits.status} ${over.status} ${over.json?.error}`,
  );
}

{
  clock = NOW;
  const handle = shareWith();
  const a = (await handle(post(shareBody(reportFiles().slice(0, 1)), { ip: "10.6.0.1" }).request)).json;
  clock = NOW + 179 * 24 * HOUR_MS;
  const day179 = await handle(get(`/share/${a.id}/rapport.html`));
  clock = NOW;
  clock = NOW + 100 * 24 * HOUR_MS;
  const b = (await handle(post(shareBody(reportFiles().slice(0, 1)), { ip: "10.6.0.2" }).request)).json;
  clock = NOW + 180 * 24 * HOUR_MS;
  const expired = await handle(get(`/share/${a.id}/rapport.html`));
  const del = await handle({ method: "DELETE", path: `/share/${b.id}`, headers: { "x-delete-token": "x" }, ip: "1", body: "" });
  const younger = await handle(get(`/share/${b.id}/rapport.html`));
  const aGone = !readdirSync(SHARE_DIR).includes(a.id) && !shares.share(a.id);
  // The sweep, on its own: the younger share expires, an orphan directory and
  // a stale upload go, anything not shaped like a share stays.
  clock = NOW + 300 * 24 * HOUR_MS;
  mkdirSync(join(SHARE_DIR, "AAAAAAAAAAAAAAAAAAAAAA"));
  mkdirSync(join(SHARE_DIR, "BBBBBBBBBBBBBBBBBBBBBB.part"));
  mkdirSync(join(SHARE_DIR, "keep-me"));
  const swept = shares.sweep(new Date(clock).toISOString(), clock + 2 * HOUR_MS);
  check(
    "expiry: served before 180 days, 404 at 180 and removed on read; the sweep takes the rest, orphans and stale uploads, and nothing else",
    "200 404 true 403 200 | true false 0 keep-me",
    `${day179.status} ${expired.status} ${aGone} ${del.status} ${younger.status} | ${swept >= 2} ${Boolean(shares.share(b.id))} ${shares.used()} ${readdirSync(SHARE_DIR).join(",")}`,
  );
}

/* ── the server itself: streaming, piping, closing early ────────────────── */

{
  clock = NOW;
  const handle = shareWith();
  const server = serve(handle, { port: 0 });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const big = Buffer.alloc(3 * 1024 * 1024, 0x61);
  const files = [{ name: "stor.csv", type: "text/csv", data: big }, ...reportFiles().slice(0, 2)];
  const made = await fetch(`${base}/relay/share`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/octet-stream" },
    body: shareBody(files),
  });
  const json = await made.json();
  const html = await fetch(`${base}/relay/share/${json.id}/rapport.html`);
  const htmlBytes = Buffer.from(await html.arrayBuffer());
  const csv = await fetch(`${base}/relay/share/${json.id}/stor.csv`);
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  const health = await fetch(`${base}/relay/health`);
  const miss = await fetch(`${base}/relay/ifcfast-miss`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(facts()) });
  // Headers only, announcing 13 MB: the answer comes before any body is sent.
  const early = await new Promise((resolve) => {
    const req = http.request(`${base}/relay/share`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/octet-stream", "content-length": String(13 * 1024 * 1024) },
    });
    req.on("response", (res) => {
      resolve(`${res.statusCode} ${res.headers.connection}`);
      req.destroy();
    });
    req.on("error", () => resolve("error"));
    req.flushHeaders();
  });
  server.close();
  check(
    "over HTTP: a 3 MB upload streams to disk, files piped back whole with the sandbox header, /health and /ifcfast-miss as before, 13 MB announced: 413 at once and closed",
    `201 200 ${CSP} true 200 true 200 202 413 close`,
    `${made.status} ${html.status} ${html.headers.get("content-security-policy")} ${htmlBytes.equals(files[1].data)} ${csv.status} ${csvBytes.equals(big)} ${health.status} ${miss.status} ${early}`,
  );
}

shares.close();
rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ command: "relay selftest", ok: failed.length === 0, assertions: results.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
