# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── deps: install from the manifests alone, so this layer is only rebuilt when
# a dependency changes. `prisma generate` runs as a postinstall step and needs
# the schema and config to exist.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── build: compile the app into Next's standalone output.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && pnpm build

# ── migrate: a one-off container that applies pending database migrations.
# It is the full build stage rather than the slim runtime image because the
# migration tool is a development dependency.
FROM build AS migrate
RUN apk add --no-cache openssl
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ── runtime: only what is needed to serve, as an unprivileged user.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
WORKDIR /app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
