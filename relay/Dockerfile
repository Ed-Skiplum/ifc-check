# ifcfast-miss relay: Node, no dependencies. See DEPLOY.md.
# node:sqlite (the database) is built into Node from 22.13 / 23.4; pinned to
# the 24.15 line it is tested on.
FROM node:24.15-alpine
WORKDIR /app
COPY relay.mjs share.mjs file-pending.mjs ./
# The database lives on a volume mounted here; owned by node so a fresh
# named volume starts writable.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
ENV PORT=8791 TRUST_PROXY=1 RELAY_DB=/data/ifc-check.db
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8791/health || exit 1
CMD ["node", "relay.mjs"]
