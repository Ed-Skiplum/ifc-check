#!/usr/bin/env node
/**
 * Files what the relay recorded but did not file: the `ifcfast_miss` rows
 * still `pending` (log only, or GitHub failed) or `failed` (an earlier run
 * of this). Same filer as the relay (`createFiler`): search first, comment
 * on the open issue or skip it when its last activity is under 24 h old,
 * otherwise a new issue with the same title and body. Each outcome goes back
 * into the row and the `event` table.
 *
 *   node file-pending.mjs --dry-run   what it would file; no GitHub call, no write
 *   node file-pending.mjs             files them (IFCFAST_ISSUES_TOKEN)
 *
 * On the box: `docker compose exec ifcfast-relay node file-pending.mjs --dry-run`.
 *
 * Rate limited on its own: one signature every 3 s, at most 50 a run, and a
 * GitHub 403 or 429 (a rate limit) ends the run with the rest still owed.
 *
 * Env: RELAY_DB (/data/ifc-check.db), IFCFAST_ISSUES_TOKEN, GITHUB_API
 * (tests only: a mock GitHub).
 */

import { pathToFileURL } from "node:url";
import { DEFAULT_DB, buildTitle, createFiler, factsOf, githubError, openStore } from "./relay.mjs";

export const DELAY = 3000;
export const MAX_PER_RUN = 50;

/**
 * One run over the owed rows. `filer` is `createFiler`'s (unused when
 * `dryRun`), `print` gets one line per row. The outcomes, for the caller.
 */
export async function filePending({
  store,
  filer,
  dryRun = false,
  delay = DELAY,
  max = MAX_PER_RUN,
  now = () => Date.now(),
  print = (line) => console.log(line),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const rows = store.owed(max);
  const outcomes = [];
  if (rows.length === 0) print("nothing pending");
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const facts = factsOf(row);
    const known = row.issue_number ? ` #${row.issue_number}` : "";
    if (dryRun) {
      print(`would file: ${buildTitle(facts)} (reports ${row.reports}, ${row.status}${known})`);
      outcomes.push({ signature: row.signature, action: "dry-run" });
      continue;
    }
    if (i > 0 && delay > 0) await sleep(delay);
    try {
      const result = await filer.file(facts);
      store.outcome(row.id, result, new Date(now()).toISOString());
      print(`${result.action} #${result.number}: ${row.signature}`);
      outcomes.push({ signature: row.signature, ...result });
    } catch (err) {
      const detail = githubError(err);
      store.outcome(row.id, { action: "failed", detail }, new Date(now()).toISOString(), "failed");
      print(`failed (${detail}): ${row.signature}`);
      outcomes.push({ signature: row.signature, action: "failed", detail });
      if (err?.status === 403 || err?.status === 429) {
        print("GitHub rate limit: stopping, the rest stay owed");
        break;
      }
    }
  }
  return outcomes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length) {
    console.error(`unknown argument: ${unknown.join(" ")}\nusage: node file-pending.mjs [--dry-run]`);
    process.exit(2);
  }
  const dryRun = args.includes("--dry-run");
  const token = process.env.IFCFAST_ISSUES_TOKEN || undefined;
  if (!dryRun && !token) {
    console.error("IFCFAST_ISSUES_TOKEN is not set (use --dry-run to only list)");
    process.exit(1);
  }
  const store = openStore(process.env.RELAY_DB ?? DEFAULT_DB);
  try {
    const filer = dryRun ? null : createFiler({ token, api: process.env.GITHUB_API ?? "https://api.github.com" });
    const outcomes = await filePending({ store, filer, dryRun });
    process.exitCode = outcomes.some((o) => o.action === "failed") ? 1 : 0;
  } finally {
    store.close();
  }
}
