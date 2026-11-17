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

    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Set-Content -LiteralPath $Path -Value $Content -Encoding utf8
    Write-Host "CREATE $Path" -ForegroundColor Green
}

function New-Directory {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $path = Join-Path $Root $RelativePath
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}

# -----------------------------------------------------------------------------
# Directories
# -----------------------------------------------------------------------------

$directories = @(
    "tests/contract",
    "tests/integration",
    "tests/helpers",
    "config/connectors",
    "config/environments",
    "docs/runbooks",
    "scripts"
)

foreach ($directory in $directories) {
    New-Directory $directory
}

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------

Write-IfMissing (Join-Path $Root "tests/contract/connectorContract.test.ts") @'
import { describe, expect, it } from 'vitest';

describe('connector contract', () => {
  it.todo('verifies that every connector implements the shared crawler contract');
  it.todo('verifies that connector results contain diagnostics');
});
'@

Write-IfMissing (Join-Path $Root "tests/contract/canonicalReviewContract.test.ts") @'
import { describe, expect, it } from 'vitest';

describe('canonical review contract', () => {
  it.todo('accepts a valid canonical review');
  it.todo('rejects an invalid canonical review');
});
'@

Write-IfMissing (Join-Path $Root "tests/integration/decodo.integration.test.ts") @'
import { describe, it } from 'vitest';

describe('Decodo integration', () => {
  it.todo('creates a browser context with the configured Decodo proxy');
  it.todo('handles proxy connection failures correctly');
});
'@

Write-IfMissing (Join-Path $Root "tests/integration/crawlerPipeline.integration.test.ts") @'
import { describe, it } from 'vitest';

describe('crawler pipeline integration', () => {
  it.todo('crawls, normalises, validates and returns canonical reviews');
  it.todo('does not treat blocked pages as successful empty results');
});
'@

Write-IfMissing (Join-Path $Root "tests/helpers/mockPage.ts") @'
import type { Page } from 'playwright';

export function createMockPage(): Partial<Page> {
  // TODO: Add a reusable Playwright Page mock for unit and contract tests.
  return {};
}
'@

Write-IfMissing (Join-Path $Root "tests/helpers/fixtureLoader.ts") @'
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadFixture(relativePath: string): Promise<string> {
  return readFile(resolve(process.cwd(), relativePath), 'utf8');
}
'@

# -----------------------------------------------------------------------------
# Connector configuration
# -----------------------------------------------------------------------------

$connectorConfigs = @{
    "google.yaml" = @'
source: google
enabled: true
maxPages: 10
maxReviewsPerRun: 100
requestTimeoutMs: 30000
delay:
  minMs: 1500
  maxMs: 4000
'@
    "tripadvisor.yaml" = @'
source: tripadvisor
enabled: true
maxPages: 10
maxReviewsPerRun: 100
requestTimeoutMs: 30000
delay:
  minMs: 1500
  maxMs: 4000
'@
    "booking.yaml" = @'
source: booking
enabled: true
maxPages: 10
maxReviewsPerRun: 100
requestTimeoutMs: 30000
delay:
  minMs: 1500
  maxMs: 4000
'@
    "holidaycheck.yaml" = @'
source: holidaycheck
enabled: true
maxPages: 10
maxReviewsPerRun: 100
requestTimeoutMs: 30000
delay:
  minMs: 1500
  maxMs: 4000
'@
    "expedia.yaml" = @'
source: expedia
enabled: true
maxPages: 10
maxReviewsPerRun: 100
requestTimeoutMs: 30000
delay:
  minMs: 1500
  maxMs: 4000
'@
    "hotels-com.yaml" = @'
source: hotels-com
enabled: true
maxPages: 10
maxReviewsPerRun: 100
requestTimeoutMs: 30000
delay:
  minMs: 1500
  maxMs: 4000
'@
}

foreach ($config in $connectorConfigs.GetEnumerator()) {
    Write-IfMissing (Join-Path $Root "config/connectors/$($config.Key)") $config.Value
}

$environmentConfigs = @{
    "development.yaml" = @'
environment: development
logLevel: debug
headless: true
'@
    "staging.yaml" = @'
environment: staging
logLevel: info
headless: true
'@
    "production.yaml" = @'
environment: production
logLevel: info
headless: true
'@
}

foreach ($config in $environmentConfigs.GetEnumerator()) {
    Write-IfMissing (Join-Path $Root "config/environments/$($config.Key)") $config.Value
}

# -----------------------------------------------------------------------------
# Documentation
# -----------------------------------------------------------------------------

Write-IfMissing (Join-Path $Root "docs/architecture.md") @'
# Crawler WTS architecture

The project contains one connector per supported review platform. Connectors
share the crawler core, browser factory, Decodo proxy provider, retry policy,
normalisation and canonical JSON validation.

Connector-specific selectors and parsing logic must remain isolated inside each
connector package.
'@

Write-IfMissing (Join-Path $Root "docs/canonical-review-json.md") @'
# Canonical review JSON

All connectors must map platform-specific data to the shared canonical review
contract before the result is persisted or sent to another service.

The contract should include, when available:

- source and external review ID
- hotel identity
- rating and rating scale
- title
- comment or review text
- public author
- review date
- language
- visible business reply
- source URL and crawler metadata

Validate the result at runtime before returning it from a connector.
'@

Write-IfMissing (Join-Path $Root "docs/connector-development-guide.md") @'
# Connector development guide

For each connector:

1. Add platform-specific selectors.
2. Add sanitised HTML fixtures.
3. Implement the parser.
4. Implement pagination or load-more behaviour.
5. Implement mapping to canonical review JSON.
6. Add blocked, challenge and consent-page detection.
7. Add unit and integration tests.
8. Verify retries, rate limits, deduplication and diagnostics.

Do not bypass CAPTCHA, authentication, paywalls or other access controls.
'@

Write-IfMissing (Join-Path $Root "docs/decodo.md") @'
# Decodo proxy configuration

Decodo is used as a configurable proxy layer to improve crawl reliability and
allow controlled proxy locations. It does not guarantee access to every website.

Credentials must be provided through environment variables or a secret manager.
Never commit proxy credentials to the repository.

Recommended environment variables:

- DECODO_PROXY_HOST
- DECODO_PROXY_PORT
- DECODO_PROXY_USERNAME
- DECODO_PROXY_PASSWORD
- DECODO_PROXY_COUNTRY
'@

Write-IfMissing (Join-Path $Root "docs/runbooks/blocked-page.md") @'
# Blocked page runbook

When a page is blocked, challenged or restricted:

1. Record the crawl ID and source.
2. Save diagnostics without storing unnecessary personal data.
3. Classify the result as blocked, not as an empty successful result.
4. Apply the configured retry policy.
5. Stop after the retry limit.
6. Escalate selector, access or compliance issues to the team.
'@

Write-IfMissing (Join-Path $Root "docs/runbooks/selector-change.md") @'
# Selector change runbook

When selector drift is detected:

1. Preserve the failing fixture.
2. Add a new fixture representing the changed markup.
3. Update selectors and parser tests.
4. Run the connector contract tests.
5. Review the change before enabling the connector again.
'@

Write-IfMissing (Join-Path $Root "docs/runbooks/connector-failure.md") @'
# Connector failure runbook

Classify connector failures as one of:

- network or proxy failure
- timeout
- blocked or challenge page
- consent page
- selector drift
- invalid source data
- schema validation failure
- unexpected application error

Emit structured diagnostics and avoid silently returning an empty result.
'@

# -----------------------------------------------------------------------------
# Utility scripts
# -----------------------------------------------------------------------------

Write-IfMissing (Join-Path $Root "scripts/run-connector.ts") @'
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    connector: { type: 'string' },
    url: { type: 'string' }
  }
});

if (!values.connector || !values.url) {
  console.error('Usage: pnpm tsx scripts/run-connector.ts --connector google --url <hotel-url>');
  process.exit(1);
}

console.log(`TODO: run connector '${values.connector}' for ${values.url}`);
'@

Write-IfMissing (Join-Path $Root "scripts/validate-fixtures.ts") @'
import { readdir } from 'node:fs/promises';

console.log('TODO: Validate connector HTML fixtures.');
console.log(await readdir('packages/connectors', { recursive: true }).catch(() => []));
'@

Write-IfMissing (Join-Path $Root "scripts/check-selectors.ts") @'
console.log('TODO: Check connector selectors against the available fixtures.');
'@

Write-Host ""
Write-Host "Project support structure created under: $Root" -ForegroundColor Cyan
Write-Host "Existing files were preserved." -ForegroundColor Cyan
