# ifcfast-miss relay: deploy

Records, and files as an ifcfast issue, every report of an element ifc-check's second check
(ifcopenshell in the browser) built geometry for where ifcfast left no mesh. `relay.mjs` is the
service, `file-pending.mjs` files what it recorded but did not file; `selftest.mjs` runs both
against a mock GitHub and a temp database (`node relay/selftest.mjs`). The same service also holds
shared report files (`share.mjs`, see [Shares](#shares)).

Every accepted report goes into SQLite first (`RELAY_DB`, on a volume): one `ifcfast_miss` row per
signature with its report count, status (`pending`, `filed`, `skipped`, `failed`) and issue, and an
`event` row per filing outcome. Only the validated fields are stored, never the client address.

Not applied to `skiplum/internal/infra/apps-server` from here; that folder belongs to the infra
session. The three pieces below are what to add there.

## 1. Token (optional)

Without a token the relay runs **log only**: it validates, records and answers `202 logged`, and the
app shows «Logget». Deploy that way first if you like; add the token later and run `file-pending`
(below) for what was logged meanwhile.

Fine-grained personal access token on the EdvardGK account:

- Repository access: only `EdvardGK/ifcfast`
- Repository permissions: Issues, Read and write. Nothing else (Metadata read-only is added by GitHub).
- Expiry: your choice; when it lapses the relay still records and answers `202 logged` (the row
  stays pending, the event says `github 401`).

On the box, in `/opt/skiplum/apps-server/.env` (not committed):

```
IFCFAST_ISSUES_TOKEN=github_pat_...
```

## 2. compose.yml service

```yaml
  ifcfast-relay:
    # ifcfast-miss relay (toolkit/ifc-check/relay): files ifcfast issues for
    # elements ifcopenshell meshed and ifcfast did not. Holds the only token.
    build: ../src/ifc-check/relay
    image: skiplum/ifcfast-relay:latest
    restart: unless-stopped
    environment:
      IFCFAST_ISSUES_TOKEN: ${IFCFAST_ISSUES_TOKEN:-}
      TRUST_PROXY: "1"
      RELAY_DB: /data/ifc-check.db
    volumes:
      - ifcfast-relay-data:/data
    deploy:
      resources:
        limits:
          memory: 128m
    expose:
      - "8791"
```

and under the top-level `volumes:`

```yaml
  ifcfast-relay-data:
```

The image owns `/data` as `node`, so a fresh named volume starts writable. The database survives
rebuilds and restarts; back it up with the volume.

## 3. Caddyfile route

Replace the `ifc-check.skiplum.com` block with:

```
ifc-check.skiplum.com {
    handle /relay/* {
        reverse_proxy ifcfast-relay:8791
    }
    handle {
        reverse_proxy ifc-check:8080
    }
}
```

`handle` keeps the `/relay` prefix; the relay accepts `/relay/ifcfast-miss` and `/ifcfast-miss`
alike. Caddy sets `X-Forwarded-For` to the client address, which the per-address limit reads
(`TRUST_PROXY=1`).

## Check after deploy

```bash
curl -s https://ifc-check.skiplum.com/relay/health
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS -H 'Origin: https://ifc-check.skiplum.com' https://ifc-check.skiplum.com/relay/ifcfast-miss
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' https://ifc-check.skiplum.com/relay/ifcfast-miss
```

Expected: `{"ok":true}`, `204`, `403`. The startup line in `docker compose logs ifcfast-relay`
says `log only (no token)` or `filing`.

## Filing what was logged

From the apps-server folder on the box:

```bash
docker compose exec ifcfast-relay node file-pending.mjs --dry-run
docker compose exec ifcfast-relay node file-pending.mjs
```

`--dry-run` lists what it would file (title, report count, status) and touches neither GitHub nor
the database; it needs no token. Without it, it files every `pending` or `failed` row the same way
the relay does (search, comment on the open issue or skip it under 24 h, otherwise a new issue),
one signature every 3 s, at most 50 a run, stopping on a GitHub rate limit. Needs
`IFCFAST_ISSUES_TOKEN` in the container.

What is recorded, from anywhere: `curl -s https://ifc-check.skiplum.com/relay/ifcfast-miss`
(signature, reports, status, issue; nothing else).

## Env reference

| var | default | |
|---|---|---|
| `RELAY_DB` | `/data/ifc-check.db` | the SQLite file, on the volume |
| `IFCFAST_ISSUES_TOKEN` | unset: log only | never logged |
| `PORT` | 8791 | |
| `TRUST_PROXY` | off | `1` behind Caddy |
| `RELAY_ALLOWED_ORIGINS` | `https://ifc-check.skiplum.com,https://skiplum.com,https://www.skiplum.com` | comma separated, replaces the list |
| `GITHUB_API` | `https://api.github.com` | tests only (a mock GitHub) |

The app posts to `https://ifc-check.skiplum.com/relay/ifcfast-miss`; a build can point elsewhere
with `VITE_IFCFAST_RELAY`.

Limits: 10 reports and 60 listings an hour per address, 50 reports a day in all, 4 KB per report. Dedupe: an open issue
whose title carries the signature gets a `reports: N` comment, or nothing if its last activity is
under 24 h old.

## Shares

The app's Share action uploads the finished report files (never the IFC) so they can be linked
and embedded in an iframe. `share.mjs`, mounted by the relay on the same port and volume.

| | |
|---|---|
| `POST /relay/share` | `Content-Type: application/octet-stream`. Body: one JSON line `{"files":[{"name","type","size"}]}` + `\n`, then each file's bytes back to back in manifest order (`new Blob([JSON.stringify(m) + "\n", ...files])`). 201 `{ id, deleteToken, urls: { name: url } }` |
| `GET /relay/share/<id>/<name>` | the file with its stored type. Unknown id or name: plain 404. No listing endpoint |
| `DELETE /relay/share/<id>` | header `X-Delete-Token: <deleteToken>`. 204; wrong or missing token 403 |

- Types: `text/html`, `application/pdf`, xlsx (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`),
  `text/csv`, `application/json`. The name's extension must be the type's (`.html .pdf .xlsx .csv .json`).
- Names: ASCII letters, digits, `.` `_` `-`, starting with a letter or digit, at most 100 characters,
  no `..`, no slash, unique in the share (case-insensitive).
- Caps: 8 files, 5 MB a file, 12 MB a share, 4 KB manifest. The manifest is checked before any
  content is read; a size over a cap, a `Content-Length` over 12 MB + 4 KB, or a byte past what the
  manifest declared ends the upload with 413 and closes the connection. Bad type, name or keys: 422.
- Rate: 20 shares an hour per address, 500 a day in all (429). Store full: 507 `store full`.
- id: 128 random bits (22 base64url characters); delete token: 256 bits, stored only as SHA-256.
- Expiry: 180 days after creation. Refused on read, swept on every new share and hourly.
- CORS: `POST`/`DELETE`/preflight only from the allowed origins (`RELAY_ALLOWED_ORIGINS`); `GET` from
  any origin. A `DELETE` without an `Origin` header (curl) is accepted with the token.
- Every share response, errors included: `Content-Security-Policy: sandbox allow-scripts allow-popups allow-downloads`
  (shared HTML runs in an opaque origin, never the app's storage), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: private, no-cache`. No `X-Frame-Options`.
  `Content-Disposition`: inline for html and json, attachment for pdf, xlsx, csv.
- Storage: bytes under `SHARE_DIR` as `<id>/<n>` (n = place in the manifest; the request never
  names a path), names/types/sizes in `RELAY_DB` (tables `share`, `share_file`). An upload is
  written to `<id>.part` and moved in whole. Memory: one chunk in hand, no base64.
- Logs: `POST /share 201` and the like; never ids, tokens or the client address.

Infra notes (for the infra session, not applied from here):

- **No Caddy change**: `/relay/*` already routes here. Check that nothing in the Caddyfile adds
  `X-Frame-Options` or a CSP of its own to `ifc-check.skiplum.com/relay/*`, or embedding breaks.
- **Review the container memory limit** (128 MB): uploads stream to disk, but up to a few 12 MB
  uploads can run at once.
- **Review the volume size**: shares can take up to `SHARE_STORE_MAX_BYTES` (2 GB) on
  `ifcfast-relay-data`, beside the database. The image already copies `share.mjs`; a rebuild is
  enough.

Check after deploy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ifc-check.skiplum.com/relay/share/AAAAAAAAAAAAAAAAAAAAAA/x.html
curl -s -D - -o /dev/null https://ifc-check.skiplum.com/relay/share/AAAAAAAAAAAAAAAAAAAAAA/x.html | grep -i content-security-policy
```

Expected: `404`, and the sandbox header.

| var | default | |
|---|---|---|
| `SHARE_DIR` | `shares/` beside `RELAY_DB` (`/data/shares`) | on the volume |
| `SHARE_STORE_MAX_BYTES` | `2147483648` (2 GB) | past it, 507 |
| `SHARE_PUBLIC_URL` | `https://ifc-check.skiplum.com/relay` | base of the returned `urls` |
