# Build from the repository root: docker build -f apps/parser/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/parser/package.json apps/parser/
RUN pnpm install --frozen-lockfile --filter @travelmo/parser...
COPY packages/core packages/core
COPY apps/parser apps/parser
RUN pnpm --filter @travelmo/parser build

FROM node:22-slim
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/parser/package.json apps/parser/
RUN pnpm install --frozen-lockfile --prod --filter @travelmo/parser...
COPY --from=build /app/apps/parser/dist apps/parser/dist
USER node
EXPOSE 8080
CMD ["node", "apps/parser/dist/server.mjs"]
