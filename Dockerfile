# Stage 1: Build TypeScript source
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Dev target (live reload)
FROM node:20-slim AS dev

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    git \
    curl \
    ca-certificates \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (same as production)
RUN npm install -g @anthropic-ai/claude-code@latest
ENV DISABLE_AUTOUPDATER=1

# Use existing node user (UID 1000) — matches docker-compose user: "1000:1000"
RUN mkdir -p /workspace && chown node:node /workspace
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN chown -R node:node /app

USER node
ENV HOME=/home/node
EXPOSE 3000

ENTRYPOINT ["npx", "tsx", "watch", "src/server.ts"]

# Stage 3: Runtime
FROM node:20-slim

# System dependencies for Claude Code
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code@latest

# Disable auto-updater in containers
ENV DISABLE_AUTOUPDATER=1

# Create non-root user
RUN groupadd -r agent && useradd -r -g agent -m -d /home/agent -s /bin/bash agent

# Create workspace and .claude directories
RUN mkdir -p /workspace && chown agent:agent /workspace
RUN mkdir -p /home/agent/.claude && chown -R agent:agent /home/agent/.claude

# Install service
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist/ ./dist/
RUN chown -R agent:agent /app

USER agent
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["node", "dist/server.js"]
