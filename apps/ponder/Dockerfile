FROM oven/bun:1.3
WORKDIR /app

COPY package.json bun.lock tsconfig*.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

ENV NODE_ENV=production
WORKDIR /app/apps/ponder

CMD ["sh", "-c", "bun x ponder start --port ${PORT:-42069}"]
