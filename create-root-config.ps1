[CmdletBinding()]
param(
    [string]$Root = "."
)

$ErrorActionPreference = "Stop"

function Write-IfMissing {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    if (Test-Path -LiteralPath $Path) {
        Write-Host "SKIP   $Path (already exists)" -ForegroundColor Yellow
        return
    }

    Set-Content -LiteralPath $Path -Value $Content -Encoding utf8
    Write-Host "CREATE $Path" -ForegroundColor Green
}

New-Item -ItemType Directory -Path $Root -Force | Out-Null

Write-IfMissing (Join-Path $Root "pnpm-workspace.yaml") @'
packages:
  - "apps/*"
  - "packages/*"
  - "packages/connectors/*"
'@

Write-IfMissing (Join-Path $Root "tsconfig.base.json") @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
'@

Write-IfMissing (Join-Path $Root "vitest.workspace.ts") @'
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  "apps/*/vitest.config.ts",
  "packages/*/vitest.config.ts",
  "packages/connectors/*/vitest.config.ts",
  "tests/vitest.config.ts"
]);
'@

Write-IfMissing (Join-Path $Root "Dockerfile") @'
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
'@

Write-Host ""
Write-Host "Root configuration files created under: $Root" -ForegroundColor Cyan
Write-Host "Existing files were preserved." -ForegroundColor Cyan
