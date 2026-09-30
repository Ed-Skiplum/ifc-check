# ifcfast-miss relay: deploy

Files the ifcfast issue when ifc-check's second check (ifcopenshell in the browser) builds geometry
for an element ifcfast left unmeshed. `relay.mjs` is the whole service; `selftest.mjs` runs it
against a mock GitHub (`node relay/selftest.mjs`).

Not applied to `skiplum/internal/infra/apps-server` from here; that folder belongs to the infra
session. The three pieces below are what to add there.

## 1. Token

Fine-grained personal access token on the EdvardGK account:

- Repository access: only `EdvardGK/ifcfast`
- Repository permissions: Issues, Read and write. Nothing else (Metadata read-only is added by GitHub).
- Expiry: your choice; the relay fails with 502 `github 401` when it lapses and the app falls back
  to the prefilled link.

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
      IFCFAST_ISSUES_TOKEN: ${IFCFAST_ISSUES_TOKEN}
      TRUST_PROXY: "1"
    deploy:
      resources:
        limits:
          memory: 128m
    expose:
      - "8791"
```

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

Expected: `{"ok":true}`, `204`, `403`.

## Env reference

| var | default | |
|---|---|---|
| `IFCFAST_ISSUES_TOKEN` | required | never logged |
| `PORT` | 8791 | |
| `TRUST_PROXY` | off | `1` behind Caddy |
| `RELAY_ALLOWED_ORIGINS` | `https://ifc-check.skiplum.com,https://skiplum.com,https://www.skiplum.com` | comma separated, replaces the list |
| `GITHUB_API` | `https://api.github.com` | tests only (a mock GitHub) |

The app posts to `https://ifc-check.skiplum.com/relay/ifcfast-miss`; a build can point elsewhere
with `VITE_IFCFAST_RELAY`.

Limits: 10 reports an hour per address, 50 a day in all, 4 KB per report. Dedupe: an open issue
whose title carries the signature gets a `reports: N` comment, or nothing if its last activity is
under 24 h old.
