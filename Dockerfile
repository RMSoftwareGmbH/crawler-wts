FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY config ./config
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig.base.json vitest.workspace.ts ./

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

CMD ["pnpm", "start"]
