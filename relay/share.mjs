/**
 * Shares: the finished report files ifc-check's Share action uploads (never
 * the IFC), kept 180 days behind an unguessable link so they can be sent on
 * and embedded in an iframe. Node, no dependencies; mounted by relay.mjs.
 *
 *   POST   /share              a new share: the manifest line, then the bytes
 *   GET    /share/<id>/<name>  one file, with its stored content type
 *   DELETE /share/<id>         with the share's token in X-Delete-Token
 *
 * The upload is one body, `application/octet-stream`: a JSON manifest on the
 * first line, `{"files":[{"name","type","size"}, ...]}` and "\n", then every
 * file's bytes back to back in manifest order. A browser builds it with
 * `new Blob([JSON.stringify(manifest) + "\n", ...files])`. The manifest is
 * checked in full before a byte of content is read, so a bad type or name, or
 * a size over the caps, is refused at once; the content then streams to disk
 * a chunk at a time, and one byte past what the manifest declared ends the
 * upload. No base64, and nothing held in memory but the chunk in hand: the
 * container has 128 MB. The answer: 201 `{ id, deleteToken, urls }`, `urls`
 * a file name to its link.
 *
 * Caps (constants below): 8 files, 5 MB a file, 12 MB a share, a 4 KB
 * manifest; 20 shares an hour per address, 500 a day in all; 2 GB in the
 * store (`SHARE_STORE_MAX_BYTES`), past which a new share is refused 507.
 * Only five types: html, pdf, xlsx, csv, json, and the name's extension must
 * be the type's. A name is ASCII letters, digits, `.`, `_` and `-`, at most
 * 100 characters, no `..` and no slash.
 *
 * Storage: the bytes under `SHARE_DIR` (default `shares/` beside `RELAY_DB`)
 * as `<id>/<n>`, n the file's place in the manifest, so nothing from the
 * request ever names a path; the names, types and sizes in SQLite. The id is
 * 128 random bits, the delete token 256 more, kept only as its SHA-256. A
 * share expires 180 days after it was made: refused on read, removed by a
 * sweep on every new share and every hour, which also clears upload leftovers.
 * The client address is never written, nor logged; nor are ids and tokens.
 *
 * Served under the app's own hostname, so every share response, errors
 * included, carries `Content-Security-Policy: sandbox ...`: a shared HTML
 * page runs in an opaque origin and can never reach the app's IndexedDB or
 * localStorage. No X-Frame-Options, and any origin may GET, so a share embeds
 * anywhere. Creating and deleting answer CORS only for the app's origins.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** The types a share may hold, each with the one extension its name takes. */
export const SHARE_TYPES = {
  "text/html": "html",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "application/json": "json",
};
/** Downloaded rather than shown; html and json open in place. */
const ATTACHMENT = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"]);
const CHARSET = new Set(["text/html", "text/csv", "application/json"]);

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SHARE_BYTES = 12 * 1024 * 1024;
export const MAX_MANIFEST = 4096;
/** The whole body: the manifest line and the largest share. */
export const MAX_SHARE_BODY = MAX_MANIFEST + 1 + MAX_SHARE_BYTES;
export const SHARE_DAYS = 180;
export const DEFAULT_STORE_MAX = 2 * 1024 ** 3;
export const DEFAULT_SHARE_BASE = "https://ifc-check.skiplum.com/relay";

/** On every share response, errors included. */
export const SHARE_HEADERS = {
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-downloads",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-cache",
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{22}$/;
const PART = /^[A-Za-z0-9_-]{22}\.part$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,94}\.(?:html|pdf|xlsx|csv|json)$/;

const isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const hasKeys = (v, keys) => Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** The manifest, or why it is refused (422, or 413 for a size over a cap). */
export function validateManifest(m) {
  const no = (error, status = 422) => ({ ok: false, error, status });
  if (!isPlain(m) || !hasKeys(m, ["files"]) || !Array.isArray(m.files)) return no("manifest");
  if (m.files.length < 1 || m.files.length > MAX_FILES) return no("files");
  const seen = new Set();
  const files = [];
  let total = 0;
  for (const f of m.files) {
    if (!isPlain(f) || !hasKeys(f, ["name", "type", "size"])) return no("file keys");
    if (typeof f.type !== "string" || !Object.hasOwn(SHARE_TYPES, f.type)) return no("type");
    if (typeof f.name !== "string" || !NAME.test(f.name) || f.name.includes("..")) return no("name");
    if (f.name.slice(f.name.lastIndexOf(".") + 1) !== SHARE_TYPES[f.type]) return no("extension");
    if (seen.has(f.name.toLowerCase())) return no("duplicate name");
    seen.add(f.name.toLowerCase());
    if (!Number.isInteger(f.size) || f.size < 1) return no("size");
    if (f.size > MAX_FILE_BYTES) return no("file size", 413);
    total += f.size;
    // Rebuilt from the checked fields, so nothing unchecked rides along.
    files.push({ name: f.name, type: f.type, size: f.size });
  }
  if (total > MAX_SHARE_BYTES) return no("share size", 413);
  return { ok: true, files, total };
}

/* ── the store ──────────────────────────────────────────────────────────── */

/** `share`: one row per share, the token only as its hash. `share_file`:
 *  name, type and size per file, `ordinal` its file on disk. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS share (
  id TEXT PRIMARY KEY,
  delete_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS share_file (
  share_id TEXT NOT NULL REFERENCES share(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (share_id, name)
);
CREATE INDEX IF NOT EXISTS share_expires ON share(expires_at);
`;

/**
 * Where shares are kept: the rows in SQLite at `path` (the relay's own
 * database, or ":memory:"), the bytes under `dir`.
 */
export function openShares(path, dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const addShare = db.prepare("INSERT INTO share (id, delete_hash, created_at, expires_at, bytes) VALUES (?, ?, ?, ?, ?)");
  const addFile = db.prepare("INSERT INTO share_file (share_id, ordinal, name, type, size) VALUES (?, ?, ?, ?, ?)");
  const byId = db.prepare("SELECT * FROM share WHERE id = ?");
  const fileOf = db.prepare(
    "SELECT f.ordinal, f.name, f.type, f.size, s.expires_at FROM share_file f JOIN share s ON s.id = f.share_id WHERE f.share_id = ? AND f.name = ?",
  );
  const drop = db.prepare("DELETE FROM share WHERE id = ?");
  const expired = db.prepare("SELECT id FROM share WHERE expires_at <= ? LIMIT 1000");
  const used = db.prepare("SELECT coalesce(sum(bytes), 0) AS bytes FROM share");

  const remove = (id) => {
    drop.run(id);
    rmSync(join(dir, id), { recursive: true, force: true });
  };

  return {
    dir,
    /** Where an upload is written until it is whole. */
    partOf: (id) => join(dir, `${id}.part`),
    pathOf: (id, ordinal) => join(dir, id, String(ordinal)),
    /** Move the written files in and record them, in one synchronous step,
     *  so a sweep never sees half of it. */
    commit(id, deleteHash, files, createdAt, expiresAt) {
      const final = join(dir, id);
      renameSync(join(dir, `${id}.part`), final);
      db.exec("BEGIN");
      try {
        addShare.run(id, deleteHash, createdAt, expiresAt, files.reduce((n, f) => n + f.size, 0));
        files.forEach((f, i) => addFile.run(id, i, f.name, f.type, f.size));
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        rmSync(final, { recursive: true, force: true });
        throw err;
      }
    },
    share: (id) => byId.get(id),
    file: (id, name) => fileOf.get(id, name),
    remove,
    /** Bytes held by every live share. */
    used: () => used.get().bytes,
    /** Expired shares out, then any directory without a row and any upload
     *  left over an hour (a request times out long before). Only entries
     *  shaped like a share are ever touched. The number removed. */
    sweep(at, nowMs) {
      let removed = 0;
      for (const { id } of expired.all(at)) {
        remove(id);
        removed += 1;
      }
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (PART.test(entry)) {
          let old = true;
          try {
            old = nowMs - statSync(full).mtimeMs > HOUR;
          } catch {}
          if (old) rmSync(full, { recursive: true, force: true });
        } else if (ID.test(entry) && !byId.get(entry)) {
          rmSync(full, { recursive: true, force: true });
          removed += 1;
        }
      }
      return removed;
    },
    close: () => db.close(),
  };
}

/* ── the handler ────────────────────────────────────────────────────────── */

/** An upload refused part way, with its status. */
class Refused extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
  }
}
const toBuffer = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v));

/** The next chunk; the client going away mid-upload is a refusal, not a
 *  store fault. */
async function pull(it) {
  try {
    return await it.next();
  } catch {
    throw new Refused(400, "aborted");
  }
}

/** The first line, at most `MAX_MANIFEST` bytes, and what came after it. */
async function readManifest(it) {
  const parts = [];
  let size = 0;
  for (;;) {
    const next = await pull(it);
    if (next.done) throw new Refused(400, "truncated");
    const chunk = toBuffer(next.value);
    const nl = chunk.indexOf(10);
    if (nl === -1) {
      size += chunk.length;
      if (size > MAX_MANIFEST) throw new Refused(413, "manifest size");
      parts.push(chunk);
      continue;
    }
    if (size + nl > MAX_MANIFEST) throw new Refused(413, "manifest size");
    parts.push(chunk.subarray(0, nl));
    return { line: Buffer.concat(parts).toString("utf8"), rest: chunk.subarray(nl + 1) };
  }
}

/** Each file's bytes to `<part>/<n>`, exactly as many as declared; a byte
 *  more anywhere ends the upload. */
async function writeFiles(it, rest, files, part) {
  for (const [i, f] of files.entries()) {
    const fh = await open(join(part, String(i)), "wx");
    try {
      let left = f.size;
      while (left > 0) {
        if (!rest.length) {
          const next = await pull(it);
          if (next.done) throw new Refused(400, "truncated");
          rest = toBuffer(next.value);
          continue;
        }
        let piece = rest.subarray(0, left);
        rest = rest.subarray(piece.length);
        left -= piece.length;
        while (piece.length) {
          const { bytesWritten } = await fh.write(piece, 0, piece.length);
          piece = piece.subarray(bytesWritten);
        }
      }
    } finally {
      await fh.close();
    }
  }
  if (rest.length) throw new Refused(413, "size");
  for (;;) {
    const next = await pull(it);
    if (next.done) return;
    if (toBuffer(next.value).length) throw new Refused(413, "size");
  }
}

/**
 * The share routes, transport-free like the relay's: `request` is { method,
 * headers (lower-case keys), ip, stream (POST: the body, an iterable of
 * chunks) }, `path` with any /relay prefix gone. The answer is { status,
 * headers, json } or, for a file, { status, headers, file } with the path to
 * send. `log` gets one line per request, never an id, token or address.
 */
export function createShareHandler({
  shares,
  origins,
  base = DEFAULT_SHARE_BASE,
  now = () => Date.now(),
  log = (line) => console.log(line),
  perIpHour = 20,
  perDay = 500,
  storeMax = DEFAULT_STORE_MAX,
}) {
  if (!shares) throw new Error("no share store");
  const hits = new Map();
  let day = [];
  /** Bytes of uploads under way, held against the store cap. */
  let inFlight = 0;
  const iso = (t = now()) => new Date(t).toISOString();

  /** Per address and hour, new shares only. */
  function limited(ip) {
    const t = now();
    const mine = (hits.get(ip) ?? []).filter((at) => t - at < HOUR);
    if (mine.length >= perIpHour) {
      hits.set(ip, mine);
      return true;
    }
    mine.push(t);
    hits.set(ip, mine);
    if (hits.size > 10000) for (const [k, v] of hits) if (!v.some((at) => t - at < HOUR)) hits.delete(k);
    return false;
  }

  async function create(request, reply) {
    if (limited(request.ip)) return reply(429, { error: "rate limit: per address" });
    if (!/^application\/octet-stream(;|$)/i.test(String(request.headers["content-type"] ?? ""))) return reply(415, { error: "content-type" });
    const length = Number(request.headers["content-length"] ?? 0);
    if (!Number.isFinite(length) || length > MAX_SHARE_BODY) return reply(413, { error: "size" });
    if (!request.stream) return reply(400, { error: "body" });
    const it = request.stream[Symbol.asyncIterator] ? request.stream[Symbol.asyncIterator]() : request.stream[Symbol.iterator]();

    let head;
    try {
      head = await readManifest(it);
    } catch (err) {
      return reply(err.status, { error: err.message });
    }
    let parsed;
    try {
      parsed = JSON.parse(head.line);
    } catch {
      return reply(400, { error: "json" });
    }
    const checked = validateManifest(parsed);
    if (!checked.ok) return reply(checked.status, { error: `invalid: ${checked.error}` });
    const t = now();
    day = day.filter((at) => t - at < DAY);
    if (day.length >= perDay) return reply(429, { error: "rate limit: daily" });
    try {
      shares.sweep(iso(t), t);
      if (shares.used() + inFlight + checked.total > storeMax) return reply(507, { error: "store full" });
    } catch {
      return reply(500, { error: "store" });
    }
    day.push(t);

    const id = randomBytes(16).toString("base64url");
    const deleteToken = randomBytes(32).toString("base64url");
    const part = shares.partOf(id);
    inFlight += checked.total;
    try {
      mkdirSync(part);
      await writeFiles(it, head.rest, checked.files, part);
      shares.commit(id, sha256(deleteToken), checked.files, iso(t), iso(t + SHARE_DAYS * DAY));
    } catch (err) {
      rmSync(part, { recursive: true, force: true });
      if (err instanceof Refused) return reply(err.status, { error: err.message });
      return err?.code === "ENOSPC" ? reply(507, { error: "store full" }) : reply(500, { error: "store" });
    } finally {
      inFlight -= checked.total;
    }
    const urls = Object.fromEntries(checked.files.map((f) => [f.name, `${base}/share/${id}/${encodeURIComponent(f.name)}`]));
    return reply(201, { id, deleteToken, urls });
  }

  function serveFile(id, rawName, reply) {
    let name;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      return reply(404, { error: "not found" });
    }
    if (!ID.test(id) || !NAME.test(name)) return reply(404, { error: "not found" });
    const row = shares.file(id, name);
    if (!row) return reply(404, { error: "not found" });
    if (row.expires_at <= iso()) {
      shares.remove(id);
      return reply(404, { error: "not found" });
    }
    const file = shares.pathOf(id, row.ordinal);
    try {
      if (!statSync(file).isFile()) return reply(404, { error: "not found" });
    } catch {
      return reply(404, { error: "not found" });
    }
    return reply(200, null, {
      "Content-Type": CHARSET.has(row.type) ? `${row.type}; charset=utf-8` : row.type,
      "Content-Length": String(row.size),
      "Content-Disposition": `${ATTACHMENT.has(row.type) ? "attachment" : "inline"}; filename="${name}"`,
    }, file);
  }

  function remove(id, request, reply) {
    const token = request.headers["x-delete-token"];
    if (!ID.test(id)) return reply(404, { error: "not found" });
    const row = shares.share(id);
    if (!row || row.expires_at <= iso()) return reply(404, { error: "not found" });
    const given = Buffer.from(sha256(typeof token === "string" ? token : ""), "hex");
    if (!timingSafeEqual(given, Buffer.from(row.delete_hash, "hex"))) return reply(403, { error: "token" });
    shares.remove(id);
    return reply(204, null);
  }

  return async function handle(request, path) {
    const origin = request.headers.origin;
    const allowed = typeof origin === "string" && origins.includes(origin);
    // Reading is open to any origin; creating and deleting only to the app's.
    const cors =
      request.method === "GET" ? { "Access-Control-Allow-Origin": "*" } : allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    const reply = (status, json, extra = {}, file) => {
      log(`${request.method} /share ${status}${json?.error ? ` ${json.error}` : ""}`);
      const headers = { ...SHARE_HEADERS, ...cors, ...extra };
      if (file) return { status, headers, file };
      return { status, headers: json === null ? headers : { ...headers, "Content-Type": "application/json" }, json };
    };
    const one = /^\/share\/([^/]+)$/.exec(path);
    const file = /^\/share\/([^/]+)\/([^/]+)$/.exec(path);
    if (path !== "/share" && !one && !file) return reply(404, { error: "not found" });

    if (request.method === "OPTIONS") {
      if (!allowed) return reply(403, { error: "origin" });
      return reply(204, null, {
        "Access-Control-Allow-Methods": "POST, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, X-Delete-Token",
        "Access-Control-Max-Age": "600",
      });
    }
    if (file) return request.method === "GET" ? serveFile(file[1], file[2], reply) : reply(405, { error: "method" });
    // No listing, ever: a share or the root read is the same 404 as nothing.
    if (request.method === "GET") return reply(404, { error: "not found" });
    if (one) {
      if (request.method !== "DELETE") return reply(405, { error: "method" });
      if (typeof origin === "string" && !allowed) return reply(403, { error: "origin" });
      try {
        return remove(one[1], request, reply);
      } catch {
        return reply(500, { error: "store" });
      }
    }
    if (request.method !== "POST") return reply(405, { error: "method" });
    if (!allowed) return reply(403, { error: "origin" });
    return create(request, reply);
  };
}
