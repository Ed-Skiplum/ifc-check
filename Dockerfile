# ifc-check — static bundle behind Caddy on skiplum-apps-1.
#
# Unlike the Streamlit tools on the same box, this app has no server side: the
# IFC is parsed in the browser by a WebAssembly build of ifcfast and never
# leaves the machine it was dropped on. So the image serves files and nothing
# else, and none of the upload-size limits the other services carry apply here.
#
# The wasm module is committed under vendor/, so this build needs no Rust
# toolchain. scripts/build-wasm.sh regenerates it when ifcfast moves.

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM caddy:2-alpine
# Caddy on the host reverse-proxies to this; this inner Caddy only serves the
# bundle. Two reasons it is not plain nginx: `application/wasm` is served
# correctly without extra mapping, and it is the same server the rest of the
# box already runs.
COPY --from=build /app/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
