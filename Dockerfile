FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json tsconfig.browser.json ./
COPY scripts/ scripts/
COPY src/ src/
RUN npm run build

# --- Production image ---
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist dist/

EXPOSE 3456

# The broker daemon is the default entrypoint.
# The MCP server is started separately via: docker exec -i <container> node dist/mcp-server.js
CMD ["node", "dist/main.js"]
