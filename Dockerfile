# =============================================================================
# ONSTAQ Automations — Production Dockerfile
# Multi-stage build for minimal image size
# =============================================================================

# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npx tsc

# --- Stage 2: Production ---
FROM node:20-slim AS production

WORKDIR /app

# Install OpenSSL for Prisma runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Install production dependencies only
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist/

EXPOSE ${PORT:-3100}

# Run migrations and start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
