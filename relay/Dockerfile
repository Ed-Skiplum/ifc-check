# ifcfast-miss relay: one Node file, no dependencies. See DEPLOY.md.
FROM node:24-alpine
WORKDIR /app
COPY relay.mjs ./
USER node
ENV PORT=8791 TRUST_PROXY=1
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8791/health || exit 1
CMD ["node", "relay.mjs"]
