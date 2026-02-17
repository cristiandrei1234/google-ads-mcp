FROM node:20-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci && npx prisma generate

FROM deps AS build

WORKDIR /app

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM base AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci --omit=dev && npx prisma generate

COPY --from=build /app/dist ./dist

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
