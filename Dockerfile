# ============================================================
# Backend AgendaPro — produção (Node + Prisma + Postgres/Neon)
# ============================================================
# Multi-stage. Debian slim (não alpine) p/ evitar dores de cabeça do
# engine do Prisma com musl/openssl.
# ------------------------------------------------------------

# ---------- Stage 1: build ----------
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
# Gera o client do Prisma e compila TS -> dist/
RUN npx prisma generate && npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Reaproveita node_modules do builder (inclui o CLI do prisma + client gerado)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

EXPOSE 4000
# Aplica migrações pendentes (forward-only) e sobe o servidor.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
