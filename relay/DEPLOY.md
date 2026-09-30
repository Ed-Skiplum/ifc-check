# ifcfast-miss relay: deploy

Records, and files as an ifcfast issue, every report of an element ifc-check's second check
(ifcopenshell in the browser) built geometry for where ifcfast left no mesh. `relay.mjs` is the
service, `file-pending.mjs` files what it recorded but did not file; `selftest.mjs` runs both
against a mock GitHub and a temp database (`node relay/selftest.mjs`).

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
