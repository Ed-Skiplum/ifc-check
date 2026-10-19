/** Fetch one konto model's L1 substrate (the seven Parquet tables and
 * `manifest.json`) and its source IFC into `qa/_data/<file id>/`, read only.
 *
 *   node scripts/l1-fetch.ts <file id> [--env production|staging] [--platform <dir>]
 *
 * Authentication is the platform account CLI's own (`skiplum login`, or
 * `SKIPLUM_TOKEN`): this script runs the CLI's `substrate` and `download`
 * commands in process and keeps the substrate response the CLI received, so
 * the token never passes through here. The CLI does not print the manifest,
 * which is why the response is tapped rather than the CLI's output parsed.
 *
 * Every table is checked against the SHA-256 the route gives. Nothing is
 * written to konto.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const env = flag("--env", "production");
const platform = flag("--platform", "C:/workspace/skiplum/internal/platform");
const fileId = args[0];
if (!fileId) {
  console.error("usage: node scripts/l1-fetch.ts <file id> [--env production|staging] [--platform <dir>]");
  process.exit(2);
}

const cli = (rel: string) => pathToFileURL(join(platform, "cli", "src", rel)).href;
const { main, realIo } = await import(cli("main.ts"));
const { downloadTo } = await import(cli("transfer.ts"));

interface SubstrateResponse {
  status: string;
  parse?: string;
  parser?: string;
  manifest?: unknown;
  manifestUrl?: string;
  tables?: Record<string, { url: string; size: number; sha256: string }> | null;
}

const out = new URL(`../qa/_data/${fileId}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const outPath = (name: string) => decodeURIComponent(new URL(name, out).pathname).replace(/^\/([A-Za-z]:)/, "$1");

let tapped: SubstrateResponse | null = null;
const io = {
  ...realIo(),
  stdout: (s: string) => process.stderr.write(s),
  fetch: async (input: string, init?: RequestInit) => {
    const r = await fetch(input, init);
    if (new URL(input).pathname.endsWith("/substrate") && r.ok) {
      tapped = (await r.clone().json()) as SubstrateResponse;
    }
    return r;
  },
};

const code = await main(["--env", env, "--json", "substrate", fileId], io);
const s = tapped as SubstrateResponse | null;
if (code !== 0 || !s) throw new Error(`substrate: CLI exit ${code}`);
if (s.status !== "ready" || !s.tables) throw new Error(`substrate is ${s.status}, no tables`);

writeFileSync(outPath("manifest.json"), JSON.stringify(s.manifest, null, 2));
writeFileSync(
  outPath("substrate.json"),
  JSON.stringify({ env, file: fileId, parse: s.parse, parser: s.parser, tables: Object.keys(s.tables) }, null, 2),
);
for (const [name, t] of Object.entries(s.tables)) {
  const got = await downloadTo(fetch, t.url, outPath(`${name}.parquet`), t.sha256);
  console.error(`  ${name.padEnd(16)} ${got.size} bytes, sha256 ok`);
}

const dl = await main(["--env", env, "--json", "download", fileId, "--out", outPath("source.ifc"), "--force"], io);
if (dl !== 0) throw new Error(`download: CLI exit ${dl}`);
console.error(`fetched ${fileId} (parse ${s.parse}, ${s.parser}) into ${outPath("")}`);
