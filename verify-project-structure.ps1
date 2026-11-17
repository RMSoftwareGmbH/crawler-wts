[CmdletBinding()]
param(
    [string]$Root = "."
)

$ErrorActionPreference = "Stop"

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$missingDirectories = [System.Collections.Generic.List[string]]::new()
$missingFiles = [System.Collections.Generic.List[string]]::new()
$presentDirectories = 0
$presentFiles = 0

function Test-ExpectedDirectory {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $fullPath = Join-Path $rootPath $RelativePath
    if (Test-Path -LiteralPath $fullPath -PathType Container) {
        $script:presentDirectories++
        Write-Host "[OK]   DIR  $RelativePath" -ForegroundColor Green
    }
    else {
        $script:missingDirectories.Add($RelativePath)
        Write-Host "[MISS] DIR  $RelativePath" -ForegroundColor Red
    }
}

function Test-ExpectedFile {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $fullPath = Join-Path $rootPath $RelativePath
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $script:presentFiles++
        Write-Host "[OK]   FILE $RelativePath" -ForegroundColor Green
    }
    else {
        $script:missingFiles.Add($RelativePath)
        Write-Host "[MISS] FILE $RelativePath" -ForegroundColor Red
    }
}

Write-Host "Verifying crawler-wts structure" -ForegroundColor Cyan
Write-Host "Root: $rootPath"
Write-Host ""

# -----------------------------------------------------------------------------
# Root files
# -----------------------------------------------------------------------------

Write-Host "ROOT CONFIGURATION" -ForegroundColor Cyan
@(
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "vitest.workspace.ts",
    "Dockerfile",
    ".env.example",
    ".gitignore",
    "README.md"
) | ForEach-Object { Test-ExpectedFile $_ }

# -----------------------------------------------------------------------------
# Root directories
# -----------------------------------------------------------------------------

Write-Host ""
Write-Host "ROOT DIRECTORIES" -ForegroundColor Cyan
@(
    "apps",
    "packages",
    "packages/connectors",
    "tests",
    "config",
    "docs",
    "scripts"
) | ForEach-Object { Test-ExpectedDirectory $_ }

# -----------------------------------------------------------------------------
# Applications
# -----------------------------------------------------------------------------

Write-Host ""
Write-Host "APPLICATIONS" -ForegroundColor Cyan
@(
    "apps/crawler-worker",
    "apps/crawler-worker/src",
    "apps/crawler-cli",
    "apps/crawler-cli/src"
) | ForEach-Object { Test-ExpectedDirectory $_ }

@(
    "apps/crawler-worker/src/main.ts",
    "apps/crawler-worker/src/worker.ts",
    "apps/crawler-worker/src/jobRunner.ts",
    "apps/crawler-worker/src/queue.ts",
    "apps/crawler-cli/src/index.ts"
) | ForEach-Object { Test-ExpectedFile $_ }

# -----------------------------------------------------------------------------
# Shared packages
# -----------------------------------------------------------------------------

Write-Host ""
Write-Host "SHARED PACKAGES" -ForegroundColor Cyan
@(
    "packages/crawler-core",
    "packages/crawler-core/src",
    "packages/crawler-contracts",
    "packages/crawler-contracts/src",
    "packages/crawler-normalization",
    "packages/crawler-normalization/src",
    "packages/crawler-observability",
    "packages/crawler-observability/src"
) | ForEach-Object { Test-ExpectedDirectory $_ }

@(
    "packages/crawler-core/src/crawler/Crawler.ts",
    "packages/crawler-core/src/crawler/CrawlerContext.ts",
    "packages/crawler-core/src/crawler/CrawlRequest.ts",
    "packages/crawler-core/src/crawler/CrawlResult.ts",
    "packages/crawler-core/src/crawler/CrawlError.ts",
    "packages/crawler-core/src/browser/browserFactory.ts",
    "packages/crawler-core/src/browser/contextFactory.ts",
    "packages/crawler-core/src/browser/pageFactory.ts",
    "packages/crawler-core/src/proxy/ProxyProvider.ts",
    "packages/crawler-core/src/proxy/decodoProvider.ts",
    "packages/crawler-core/src/proxy/proxyHealth.ts",
    "packages/crawler-core/src/pagination/PaginationStrategy.ts",
    "packages/crawler-core/src/pagination/loadMoreStrategy.ts",
    "packages/crawler-core/src/retry/retryPolicy.ts",
    "packages/crawler-core/src/retry/backoff.ts",
    "packages/crawler-core/src/diagnostics/CrawlDiagnostics.ts",
    "packages/crawler-core/src/diagnostics/crawlEvents.ts",
    "packages/crawler-core/src/index.ts",
    "packages/crawler-contracts/src/review/canonicalReview.ts",
    "packages/crawler-contracts/src/review/canonicalReview.schema.ts",
    "packages/crawler-contracts/src/review/rating.ts",
    "packages/crawler-contracts/src/hotel/hotelIdentity.ts",
    "packages/crawler-contracts/src/source/sourceType.ts",
    "packages/crawler-contracts/src/crawl/crawlRequest.schema.ts",
    "packages/crawler-contracts/src/crawl/crawlResult.schema.ts",
    "packages/crawler-contracts/src/index.ts",
    "packages/crawler-normalization/src/normalizeReview.ts",
    "packages/crawler-normalization/src/normalizeRating.ts",
    "packages/crawler-normalization/src/normalizeDate.ts",
    "packages/crawler-normalization/src/normalizeLanguage.ts",
    "packages/crawler-normalization/src/externalReviewId.ts",
    "packages/crawler-normalization/src/deduplicateReviews.ts",
    "packages/crawler-normalization/src/index.ts",
    "packages/crawler-observability/src/logger.ts",
    "packages/crawler-observability/src/metrics.ts",
    "packages/crawler-observability/src/tracing.ts",
    "packages/crawler-observability/src/index.ts"
) | ForEach-Object { Test-ExpectedFile $_ }

# -----------------------------------------------------------------------------
# Connector packages
# -----------------------------------------------------------------------------

Write-Host ""
Write-Host "CONNECTORS" -ForegroundColor Cyan
$connectors = @(
    @{ Directory = "google"; Prefix = "Google"; Test = "GoogleParser.test.ts" },
    @{ Directory = "tripadvisor"; Prefix = "Tripadvisor"; Test = "TripadvisorParser.test.ts" },
    @{ Directory = "booking"; Prefix = "Booking"; Test = "BookingParser.test.ts" },
    @{ Directory = "holidaycheck"; Prefix = "HolidayCheck"; Test = "" },
    @{ Directory = "expedia"; Prefix = "Expedia"; Test = "" },
    @{ Directory = "hotels-com"; Prefix = "HotelsCom"; Test = "" }
)

foreach ($connector in $connectors) {
    $base = "packages/connectors/$($connector.Directory)"
    Test-ExpectedDirectory $base
    Test-ExpectedDirectory "$base/src"
    Test-ExpectedDirectory "$base/tests"
    Test-ExpectedDirectory "$base/tests/fixtures"

    @(
        "$base/src/$($connector.Prefix)Crawler.ts",
        "$base/src/$($connector.Prefix)Parser.ts",
        "$base/src/$($connector.Prefix)Selectors.ts",
        "$base/src/$($connector.Prefix)Pagination.ts",
        "$base/src/$($connector.Prefix)Mapper.ts",
        "$base/src/index.ts"
    ) | ForEach-Object { Test-ExpectedFile $_ }

    if ($connector.Directory -eq "google") {
        Test-ExpectedFile "$base/src/GoogleDetection.ts"
        @(
            "basic.html",
            "pagination.html",
            "missing-fields.html",
            "blocked.html",
            "challenge.html"
        ) | ForEach-Object { Test-ExpectedFile "$base/tests/fixtures/$_" }
        Test-ExpectedFile "$base/tests/GoogleCrawler.test.ts"
    }

    if ($connector.Test -ne "") {
        Test-ExpectedFile "$base/tests/$($connector.Test)"
    }
}

# -----------------------------------------------------------------------------
# Tests, configuration, documentation and scripts
# -----------------------------------------------------------------------------

Write-Host ""
Write-Host "PROJECT TESTS" -ForegroundColor Cyan
@(
    "tests/contract",
    "tests/integration",
    "tests/helpers",
    "tests/contract/connectorContract.test.ts",
    "tests/contract/canonicalReviewContract.test.ts",
    "tests/integration/decodo.integration.test.ts",
    "tests/integration/crawlerPipeline.integration.test.ts",
    "tests/helpers/mockPage.ts",
    "tests/helpers/fixtureLoader.ts"
) | ForEach-Object {
    if ($_ -match '\.') { Test-ExpectedFile $_ } else { Test-ExpectedDirectory $_ }
}

Write-Host ""
Write-Host "CONFIGURATION" -ForegroundColor Cyan
@(
    "config/connectors",
    "config/environments",
    "config/connectors/google.yaml",
    "config/connectors/tripadvisor.yaml",
    "config/connectors/booking.yaml",
    "config/connectors/holidaycheck.yaml",
    "config/connectors/expedia.yaml",
    "config/connectors/hotels-com.yaml",
    "config/environments/development.yaml",
    "config/environments/staging.yaml",
    "config/environments/production.yaml"
) | ForEach-Object {
    if ($_ -match '\.') { Test-ExpectedFile $_ } else { Test-ExpectedDirectory $_ }
}

Write-Host ""
Write-Host "DOCUMENTATION" -ForegroundColor Cyan
@(
    "docs/architecture.md",
    "docs/canonical-review-json.md",
    "docs/connector-development-guide.md",
    "docs/decodo.md",
    "docs/runbooks",
    "docs/runbooks/blocked-page.md",
    "docs/runbooks/selector-change.md",
    "docs/runbooks/connector-failure.md"
) | ForEach-Object {
    if ($_ -match '\.') { Test-ExpectedFile $_ } else { Test-ExpectedDirectory $_ }
}

Write-Host ""
Write-Host "UTILITY SCRIPTS" -ForegroundColor Cyan
@(
    "scripts/run-connector.ts",
    "scripts/validate-fixtures.ts",
    "scripts/check-selectors.ts"
) | ForEach-Object { Test-ExpectedFile $_ }

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

$totalExpected = $presentDirectories + $presentFiles + $missingDirectories.Count + $missingFiles.Count
$present = $presentDirectories + $presentFiles
$missing = $missingDirectories.Count + $missingFiles.Count

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Present: $present / $totalExpected"
Write-Host "Missing: $missing"

if ($missing -eq 0) {
    Write-Host "STATUS: Structure is complete." -ForegroundColor Green
    exit 0
}

Write-Host "STATUS: Structure is incomplete." -ForegroundColor Red

if ($missingDirectories.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing directories:" -ForegroundColor Red
    $missingDirectories | ForEach-Object { Write-Host "  - $_" }
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing files:" -ForegroundColor Red
    $missingFiles | ForEach-Object { Write-Host "  - $_" }
}

exit 1
