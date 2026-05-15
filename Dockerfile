# syntax=docker/dockerfile:1.6
#
# node-red-ai — fork of Node-RED with built-in AI assistant sidebar.
# Multi-stage build: editor-client + sass are compiled in `builder`,
# only the runtime tree is copied into the final image.

ARG NODE_VERSION=18-bookworm-slim

# ---------- builder ----------
FROM node:${NODE_VERSION} AS builder

ENV CI=1
WORKDIR /src

# Build deps for native node modules (bcrypt, etc.) used by editor-api.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first to take advantage of layer cache.
COPY package.json package-lock.json* ./
COPY packages/node_modules/node-red/package.json packages/node_modules/node-red/
COPY packages/node_modules/@node-red/editor-api/package.json packages/node_modules/@node-red/editor-api/
COPY packages/node_modules/@node-red/editor-client/package.json packages/node_modules/@node-red/editor-client/
COPY packages/node_modules/@node-red/nodes/package.json packages/node_modules/@node-red/nodes/
COPY packages/node_modules/@node-red/registry/package.json packages/node_modules/@node-red/registry/
COPY packages/node_modules/@node-red/runtime/package.json packages/node_modules/@node-red/runtime/
COPY packages/node_modules/@node-red/util/package.json packages/node_modules/@node-red/util/

RUN npm install --no-audit --no-fund

# Now bring in the rest of the source and run the build.
COPY . .
RUN npx grunt build

# Drop dev deps so we can copy a slim node_modules into the runtime stage.
RUN npm prune --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="node-red-ai" \
      org.opencontainers.image.description="Node-RED fork with built-in AI assistant (Agent + Skills)" \
      org.opencontainers.image.source="https://github.com/caishenao/node-red-ai" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    NODE_RED_HOME=/usr/src/node-red \
    NODE_RED_USER_DIR=/data \
    FLOWS=flows.json \
    PATH=/usr/src/node-red/node_modules/.bin:$PATH

# Tini for proper PID 1 signal handling; tools used by palette manager.
# The base image already provides a `node` user at UID 1000 — reuse it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates curl git python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown -R node:node /data

WORKDIR ${NODE_RED_HOME}

COPY --from=builder --chown=node:node /src/package.json ./package.json
COPY --from=builder --chown=node:node /src/node_modules ./node_modules
COPY --from=builder --chown=node:node /src/packages ./packages

USER node

EXPOSE 1880

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:1880/ || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "node", "packages/node_modules/node-red/red.js"]
CMD ["--userDir", "/data", "-v"]
