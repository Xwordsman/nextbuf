# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
ARG NEXTBUF_VERSION=0.13.0
ARG NEXTBUF_COMMIT=unknown
ARG NEXTBUF_BUILD_TIME=unknown
ENV NEXTBUF_VERSION=$NEXTBUF_VERSION
ENV NEXTBUF_COMMIT=$NEXTBUF_COMMIT
ENV NEXTBUF_BUILD_TIME=$NEXTBUF_BUILD_TIME
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY deploy/runtime-package /runtime-deps
RUN --mount=type=cache,id=pnpm-runtime,target=/pnpm/store \
  pnpm --dir /runtime-deps install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
ARG NEXTBUF_VERSION=0.13.0
ARG NEXTBUF_COMMIT=unknown
ARG NEXTBUF_BUILD_TIME=unknown
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXTBUF_VERSION=$NEXTBUF_VERSION
ENV NEXTBUF_COMMIT=$NEXTBUF_COMMIT
ENV NEXTBUF_BUILD_TIME=$NEXTBUF_BUILD_TIME
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data/uploads \
  && chown -R node:node /app
COPY --from=production-dependencies --chown=node:node /runtime-deps/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/standalone ./.next/standalone
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/src/generated/prisma ./src/generated/prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/deploy/docker ./deploy/docker
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN chmod 0755 /app/deploy/docker/entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/docker/entrypoint.sh"]
CMD ["web"]
