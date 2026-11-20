import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";
import {
  canonicalReviewSchema,
  crawlRequestSchema,
} from "../../../crawler-contracts/src/index.js";
import {
  createBrowserPool,
  createBrowserSession,
  CrawlError,
  isRetryableFailure,
  retryDelayMs,
  type BrowserSession,
  type BrowserPool,
  type CrawlDiagnostics,
  type CrawlFailureClassification,
  type CrawlRequest,
  type CrawlResult,
} from "../../../crawler-core/src/index.js";
import { logger } from "../../../crawler-observability/src/index.js";
import { deduplicateReviews } from "../../../crawler-normalization/src/index.js";
import { GoogleDetection } from "./GoogleDetection.js";
import { GoogleMapper } from "./GoogleMapper.js";
import { GooglePagination } from "./GooglePagination.js";
import { GoogleParser } from "./GoogleParser.js";
import { GoogleReviewInteraction } from "./GoogleReviewInteraction.js";
import { GoogleSelectors, selectorList } from "./GoogleSelectors.js";

const CRAWLER_VERSION = "1.0.0";
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_REVIEWS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_SETTLE_WAIT_MS = 9_000;
const DEFAULT_PANEL_WAIT_MS = 5_000;
const DEFAULT_INTERACTION_WAIT_MS = 1_000;
const OPTIMIZED_DELAY_MS = 500;
const OPTIMIZED_PANEL_WAIT_MS = 1_200;
const OPTIMIZED_INTERACTION_WAIT_MS = 250;

export interface GoogleCrawlerOptions {
  sessionFactory?: (options: {
    proxyEnabled: boolean;
    locale?: string;
    headless?: boolean;
    optimizationEnabled: boolean;
  }) => Promise<BrowserSession>;
  browserPoolFactory?: (options: {
    proxyEnabled: boolean;
    headless?: boolean;
    optimizationEnabled: boolean;
  }) => Promise<BrowserPool>;
  parser?: GoogleParser;
  mapper?: GoogleMapper;
  detection?: GoogleDetection;
  pagination?: GooglePagination;
  now?: () => Date;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  delayMs?: number;
  settleWaitMs?: number;
  initialWaitMs?: number;
  panelWaitMs?: number;
  interactionWaitMs?: number;
  reviewInteraction?: GoogleReviewInteraction;
  optimizationEnabled?: boolean;
}

type CrawlStage =
  | "navigation"
  | "detection"
  | "interaction"
  | "pagination"
  | "parser"
  | "mapping";

function maxReviewsPerRun(requestedMaxReviews?: number): number {
  if (requestedMaxReviews !== undefined) {
    return requestedMaxReviews;
  }
  const configuredValue = process.env.GOOGLE_MAX_REVIEWS_PER_RUN;
  if (configuredValue === undefined) {
    return DEFAULT_MAX_REVIEWS;
  }
  const value = configuredValue.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error("GOOGLE_MAX_REVIEWS_PER_RUN must be a positive integer.");
  }
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error("GOOGLE_MAX_REVIEWS_PER_RUN must be a positive integer.");
  }
  return parsedValue;
}

function configuredWaitMs(name: string, defaultValue: number): number {
  const configuredValue = process.env[name];
  if (configuredValue === undefined) {
    return defaultValue;
  }
  const value = configuredValue.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsedValue;
}

function diagnosticsUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : "The crawl failed unexpectedly.";
  return raw
    .replace(/https?:\/\/[^\s)]+/gi, (value) => diagnosticsUrl(value))
    .replace(
      /((?:password|token|cookie|authorization|secret|api[_-]?key|session[_-]?id)=)[^\s&]+/gi,
      "$1[redacted]",
    )
    .slice(0, 500);
}

async function capturePageMetadata(
  page: BrowserSession["page"],
  diagnostics: CrawlDiagnostics,
): Promise<void> {
  try {
    const currentUrl = page.url();
    if (currentUrl) {
      diagnostics.finalUrl = diagnosticsUrl(currentUrl);
    }
  } catch {
    logger.warn(
      { crawlId: diagnostics.crawlId },
      "Google final URL could not be captured",
    );
  }
  try {
    diagnostics.documentTitle = await page.title();
  } catch {
    logger.warn(
      { crawlId: diagnostics.crawlId },
      "Google document title could not be captured",
    );
  }
}

async function captureDiagnosticScreenshot(
  session: BrowserSession,
  diagnostics: CrawlDiagnostics,
  attempt: number,
): Promise<void> {
  if (process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT !== "true") {
    return;
  }
  if (!session.diagnosticScreenshot) {
    logger.warn(
      { crawlId: diagnostics.crawlId },
      "Google diagnostic screenshot is unavailable for this browser session",
    );
    return;
  }

  const screenshotPath = join(
    tmpdir(),
    `google-crawler-${diagnostics.crawlId}-${attempt + 1}.png`,
  );
  try {
    await session.diagnosticScreenshot(screenshotPath, [
      ...GoogleSelectors.reviewCards,
      "img",
    ]);
    diagnostics.diagnosticScreenshotPath = screenshotPath;
  } catch {
    logger.warn(
      { crawlId: diagnostics.crawlId },
      "Google diagnostic screenshot could not be captured",
    );
  }
}

async function captureDiagnosticReviewCard(
  session: BrowserSession,
  diagnostics: CrawlDiagnostics,
): Promise<void> {
  if (process.env.GOOGLE_CRAWLER_DOM_DIAGNOSTIC !== "true") {
    return;
  }
  if (!session.diagnosticReviewCardSnapshot) {
    logger.warn(
      { crawlId: diagnostics.crawlId },
      "Google review-card diagnostic is unavailable for this browser session",
    );
    return;
  }

  try {
    const snapshot = await session.diagnosticReviewCardSnapshot(
      selectorList(GoogleSelectors.reviewCards),
    );
    if (!snapshot) {
      return;
    }
    const diagnosticPath = join(
      tmpdir(),
      `google-review-card-${diagnostics.crawlId}.html`,
    );
    await writeFile(diagnosticPath, snapshot, "utf8");
    diagnostics.diagnosticDomPath = diagnosticPath;
  } catch (error) {
    logger.warn(
      {
        crawlId: diagnostics.crawlId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        error: safeErrorMessage(error),
      },
      "Google review-card diagnostic could not be captured",
    );
  }
}

function isNavigationResponse(value: unknown): value is { status(): number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "function"
  );
}

function classifyFailure(
  error: unknown,
  stage: CrawlStage,
  proxyEnabled: boolean,
): CrawlFailureClassification {
  if (error instanceof CrawlError) {
    return error.classification;
  }
  if (error instanceof ZodError) {
    return "schema_validation_failure";
  }

  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|TimeoutError/i.test(message)) {
    return "timeout";
  }
  if (proxyEnabled && /proxy|tunnel|ECONNREFUSED/i.test(message)) {
    return "proxy_failure";
  }
  if (/net::ERR|ENOTFOUND|ECONNRESET|network|fetch failed/i.test(message)) {
    return "network_failure";
  }
  if (stage === "navigation") {
    return "navigation_failure";
  }
  if (stage === "pagination") {
    return "pagination_failure";
  }
  if (stage === "interaction") {
    return "interaction_failure";
  }
  if (stage === "parser") {
    return "parser_failure";
  }
  return "schema_validation_failure";
}

export class GoogleCrawler {
  private readonly sessionFactory: NonNullable<
    GoogleCrawlerOptions["sessionFactory"]
  >;
  private readonly browserPoolFactory: NonNullable<
    GoogleCrawlerOptions["browserPoolFactory"]
  >;
  private readonly parser: GoogleParser;
  private readonly mapper: GoogleMapper;
  private readonly detection: GoogleDetection;
  private readonly pagination: GooglePagination;
  private readonly reviewInteraction: GoogleReviewInteraction;
  private readonly now: () => Date;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly delayMs: number;
  private readonly settleWaitMs: number;
  private readonly panelWaitMs: number;
  private readonly interactionWaitMs: number;
  private readonly optimizationEnabled: boolean;

  constructor(options: GoogleCrawlerOptions = {}) {
    this.optimizationEnabled =
      options.optimizationEnabled ??
      process.env.GOOGLE_CRAWLER_OPTIMIZE === "true";
    this.sessionFactory =
      options.sessionFactory ??
      ((browserOptions) =>
        createBrowserSession({
          ...browserOptions,
          headless: browserOptions.headless ?? true,
        }));
    this.browserPoolFactory =
      options.browserPoolFactory ??
      ((browserOptions) =>
        createBrowserPool({
          ...browserOptions,
          headless: browserOptions.headless ?? true,
        }));
    this.parser = options.parser ?? new GoogleParser();
    this.mapper = options.mapper ?? new GoogleMapper();
    this.detection = options.detection ?? new GoogleDetection();
    this.pagination = options.pagination ?? new GooglePagination();
    this.reviewInteraction =
      options.reviewInteraction ?? new GoogleReviewInteraction();
    this.now = options.now ?? (() => new Date());
    this.maxRetries = Math.max(0, options.maxRetries ?? 1);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 400);
    this.delayMs = Math.max(
      0,
      options.delayMs ??
        configuredWaitMs(
          "GOOGLE_CRAWLER_PAGINATION_WAIT_MS",
          this.optimizationEnabled ? OPTIMIZED_DELAY_MS : DEFAULT_DELAY_MS,
        ),
    );
    this.settleWaitMs = Math.max(
      0,
      options.settleWaitMs ??
        options.initialWaitMs ??
        configuredWaitMs("GOOGLE_CRAWLER_SETTLE_MS", DEFAULT_SETTLE_WAIT_MS),
    );
    this.panelWaitMs = Math.max(
      0,
      options.panelWaitMs ??
        configuredWaitMs(
          "GOOGLE_CRAWLER_PANEL_WAIT_MS",
          this.optimizationEnabled
            ? OPTIMIZED_PANEL_WAIT_MS
            : DEFAULT_PANEL_WAIT_MS,
        ),
    );
    this.interactionWaitMs = Math.max(
      0,
      options.interactionWaitMs ??
        configuredWaitMs(
          "GOOGLE_CRAWLER_INTERACTION_WAIT_MS",
          this.optimizationEnabled
            ? OPTIMIZED_INTERACTION_WAIT_MS
            : DEFAULT_INTERACTION_WAIT_MS,
        ),
    );
  }

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    return this.crawlWithSessionFactory(request, this.sessionFactory);
  }

  async crawlBatch(requests: readonly CrawlRequest[]): Promise<CrawlResult[]> {
    if (requests.length === 0) {
      return [];
    }
    if (!this.optimizationEnabled) {
      const results: CrawlResult[] = [];
      for (const request of requests) {
        results.push(await this.crawl(request));
      }
      return results;
    }

    const proxyModes = new Set(
      requests.map(
        (request) =>
          request.proxyEnabled ??
          process.env.DECODO_PROXY_ENABLED === "true",
      ),
    );
    if (proxyModes.size !== 1) {
      throw new CrawlError(
        "configuration_failure",
        "A crawl batch must use the same proxy mode for every hotel.",
      );
    }

    const pool = await this.browserPoolFactory({
      proxyEnabled: proxyModes.values().next().value ?? false,
      optimizationEnabled: this.optimizationEnabled,
      ...(process.env.GOOGLE_CRAWLER_HEADED === "true"
        ? { headless: false }
        : {}),
    });
    try {
      const results: CrawlResult[] = [];
      for (const request of requests) {
        results.push(
          await this.crawlWithSessionFactory(
            request,
            async (sessionOptions) =>
              pool.createSession({
                ...(sessionOptions.locale
                  ? { locale: sessionOptions.locale }
                  : {}),
              }),
          ),
        );
      }
      return results;
    } finally {
      await pool.close();
    }
  }

  private async crawlWithSessionFactory(
    request: CrawlRequest,
    sessionFactory: NonNullable<GoogleCrawlerOptions["sessionFactory"]>,
  ): Promise<CrawlResult> {
    const startedAt = this.now().toISOString();
    const diagnostics: CrawlDiagnostics = {
      crawlId: randomUUID(),
      source: "google",
      hotelUrl: diagnosticsUrl(request.url),
      startedAt,
      finishedAt: startedAt,
      pagesVisited: 0,
      reviewsExtracted: 0,
      reviewsAccepted: 0,
      duplicatesRemoved: 0,
      retries: 0,
      crawlerVersion: CRAWLER_VERSION,
      consentPageDetected: false,
      challengePageDetected: false,
      authenticationPageDetected: false,
      restrictedMapsViewDetected: false,
    };

    const validatedRequest = crawlRequestSchema.safeParse(request);
    if (!validatedRequest.success) {
      diagnostics.failure = {
        classification: "invalid_page",
        message: "Crawl request is invalid.",
      };
      return this.failureResult(diagnostics);
    }

    const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
    let maxReviews: number;
    try {
      maxReviews = maxReviewsPerRun(request.maxReviews);
    } catch (error) {
      diagnostics.stoppedBecause = "invalid_max_reviews_configuration";
      diagnostics.failure = {
        classification: "configuration_failure",
        message:
          error instanceof Error
            ? error.message
            : "GOOGLE_MAX_REVIEWS_PER_RUN must be a positive integer.",
      };
      return this.failureResult(diagnostics);
    }
    diagnostics.maxReviewsPerRun = maxReviews;
    diagnostics.reviewCardCountBeforeScroll = 0;
    diagnostics.reviewCardCountAfterEachScroll = [];
    diagnostics.scrollAttempts = 0;
    diagnostics.newReviewsPerScroll = [];
    diagnostics.totalUniqueCardsSeen = 0;
    const interactionEnabled =
      process.env.GOOGLE_CRAWLER_INTERACT === "true";
    const settleWaitMs = Math.min(
      this.settleWaitMs,
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    diagnostics.interactionEnabled = interactionEnabled;
    diagnostics.settleWaitMs = settleWaitMs;
    diagnostics.optimizationEnabled = this.optimizationEnabled;
    diagnostics.abortedResourceTypes = [];
    diagnostics.stoppedBecause =
      interactionEnabled ? "review_panel_unavailable" : "interaction_disabled";
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const proxyEnabled =
      request.proxyEnabled ?? process.env.DECODO_PROXY_ENABLED === "true";

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let session: BrowserSession | undefined;
      let stage: CrawlStage = "navigation";
      let failure:
        | { classification: CrawlFailureClassification; message: string }
        | undefined;
      let attemptReviews: CrawlResult["reviews"] = [];

      try {
        session = await sessionFactory({
          proxyEnabled,
          ...(request.locale ? { locale: request.locale } : {}),
          ...(process.env.GOOGLE_CRAWLER_HEADED === "true"
            ? { headless: false }
            : {}),
          optimizationEnabled: this.optimizationEnabled,
        });
        const activeSession: BrowserSession = session;
        const navigationStartedAt = Date.now();
        const response = await session.page.goto(request.url, {
          timeout: timeoutMs,
          waitUntil: this.optimizationEnabled ? "domcontentloaded" : "load",
        });
        diagnostics.navigationMs = Date.now() - navigationStartedAt;
        diagnostics.pagesVisited += 1;
        await capturePageMetadata(session.page, diagnostics);
        if (isNavigationResponse(response)) {
          const status = response.status();
          diagnostics.navigationStatus = status;
          if (status === 401) {
            diagnostics.authenticationPageDetected = true;
          }
          if (status >= 400) {
            const classification =
              status === 403 || status === 429
                ? "blocked_page"
                : status === 401
                  ? "authentication_required"
                  : status < 500
                    ? "invalid_page"
                    : "navigation_failure";
            throw new CrawlError(
              classification,
              `Google navigation returned HTTP ${status}.`,
            );
          }
        }
        const readiness = await this.reviewInteraction.waitForMapsContent(
          session.page,
          settleWaitMs,
        );
        diagnostics.mapsContentReady = readiness.mapsContentReady;
        diagnostics.reviewsControlSearchStartedAt =
          readiness.reviewsControlSearchStartedAt;
        diagnostics.reviewsControlSearchFinishedAt =
          readiness.reviewsControlSearchFinishedAt;
        diagnostics.navigationMs = Date.now() - navigationStartedAt;
        const resolvedRequest: CrawlRequest = {
          ...request,
          url: session.page.url() || request.url,
        };
        let incrementalParsingMs = 0;
        const collectExternalReviewIds = async (): Promise<readonly string[]> => {
          const parseStartedAt = Date.now();
          const parsed = await this.parser.parse(
            activeSession.page,
            resolvedRequest.url,
            {
              lastSeenReviewId: request.lastSeenReviewId,
              persistedReviewIds: request.persistedReviewIds,
            },
          );
          incrementalParsingMs += Date.now() - parseStartedAt;
          return [
            ...parsed.reviews.map((review) => review.externalReviewId),
            ...(parsed.stoppedAtLastSeenReviewId && request.lastSeenReviewId
              ? [request.lastSeenReviewId]
              : []),
          ];
        };

        stage = "detection";
        let detection = await this.detection.classify(
          session.page,
          request.url,
          {
            deferRestrictedMapsView: interactionEnabled,
            deferUnrecognizedPlacePage: interactionEnabled,
          },
        );
        const protectionStatus = [
          "challenge_page",
          "consent_page",
          "authentication_required",
          "blocked_page",
        ].includes(detection.status);
        diagnostics.reviewCardCountBeforeScroll = detection.reviewCardCount;
        if (protectionStatus && interactionEnabled) {
          diagnostics.stoppedBecause = "protection_page";
        }

        if (
          interactionEnabled &&
          !protectionStatus &&
          (detection.status === "valid" ||
            detection.detections.restrictedMapsView)
        ) {
          stage = "interaction";
          diagnostics.reviewsInteractionAttempted = true;
          diagnostics.reviewsControlFound = false;
          diagnostics.reviewsControlClicked = false;
          diagnostics.reviewsPanelFound = false;
          diagnostics.reviewCardCountBeforeClick = detection.reviewCardCount;
          diagnostics.reviewCardCountAfterClick = detection.reviewCardCount;
          const interactionResult = await this.reviewInteraction.run(
            session.page,
            {
              timeoutMs,
              maxReviews,
              panelWaitMs: this.panelWaitMs,
              interactionWaitMs: this.interactionWaitMs,
              reviewsControlSearchStartedAt:
                readiness.reviewsControlSearchStartedAt,
              persistedReviewIds: request.persistedReviewIds,
              lastSeenReviewId: request.lastSeenReviewId,
              collectExternalReviewIds,
              onProgress: (progress) => Object.assign(diagnostics, progress),
            },
          );
          Object.assign(diagnostics, interactionResult);
          diagnostics.mapsContentReady =
            diagnostics.mapsContentReady ||
            interactionResult.reviewsControlFound ||
            interactionResult.reviewsPanelFound ||
            interactionResult.reviewCardCountAfterClick > 0;
          diagnostics.parsingMs = incrementalParsingMs;
          await capturePageMetadata(session.page, diagnostics);
          detection = await this.detection.classify(session.page, request.url);
        } else if (interactionEnabled) {
          diagnostics.reviewsInteractionAttempted = false;
          diagnostics.reviewsControlFound = false;
          diagnostics.reviewsControlClicked = false;
          diagnostics.reviewsPanelFound = false;
          diagnostics.reviewCardCountBeforeClick = detection.reviewCardCount;
          diagnostics.reviewCardCountAfterClick = detection.reviewCardCount;
          detection = await this.detection.classify(session.page, request.url);
        }

        if (
          !diagnostics.mapsContentReady &&
          !diagnostics.reviewsControlFound &&
          !detection.detections.restrictedMapsView &&
          !detection.detections.challengePage &&
          !detection.detections.consentPage &&
          !detection.detections.authenticationPage
        ) {
          throw new CrawlError(
            "timeout",
            "Google Maps content did not become ready within the configured settle interval.",
          );
        }

        await captureDiagnosticReviewCard(session, diagnostics);
        diagnostics.abortedResourceTypes = [
          ...new Set([
            ...(diagnostics.abortedResourceTypes ?? []),
            ...(session.abortedResourceTypes?.() ?? []),
          ]),
        ];
        diagnostics.pageClassification = detection.status;
        diagnostics.reviewCardCount = detection.reviewCardCount;
        diagnostics.consentPageDetected = detection.detections.consentPage;
        diagnostics.challengePageDetected = detection.detections.challengePage;
        diagnostics.authenticationPageDetected =
          detection.detections.authenticationPage;
        diagnostics.restrictedMapsViewDetected =
          detection.detections.restrictedMapsView;
        if (detection.status !== "valid") {
          throw new CrawlError(
            detection.status,
            detection.reason ?? "Google page is not available for crawling.",
          );
        }

        stage = "pagination";
        const pagination = await this.pagination.run(
          session.page,
          {
            maxPages,
            maxReviews,
            delayMs: this.delayMs,
            timeoutMs,
            persistedReviewIds: request.persistedReviewIds,
            lastSeenReviewId: request.lastSeenReviewId,
            collectExternalReviewIds,
          },
          this.detection,
          request.url,
        );
        diagnostics.parsingMs = incrementalParsingMs;
        diagnostics.paginationStoppedBecause = pagination.stoppedBecause;
        if (
          diagnostics.stoppedBecause === "interaction_disabled" ||
          diagnostics.stoppedBecause === "review_panel_unavailable" ||
          pagination.stoppedBecause === "max_reviews_reached" ||
          pagination.stoppedBecause === "no_new_cards" ||
          pagination.stoppedBecause === "max_pages_reached"
        ) {
          diagnostics.stoppedBecause = pagination.stoppedBecause;
        }
        diagnostics.pagesVisited += pagination.pagesVisited - 1;

        stage = "parser";
        const parseStartedAt = Date.now();
        const parsed = await this.parser.parse(
          session.page,
          resolvedRequest.url,
          {
            lastSeenReviewId: request.lastSeenReviewId,
            persistedReviewIds: request.persistedReviewIds,
          },
        );
        diagnostics.parsingMs =
          (diagnostics.parsingMs ?? 0) + Date.now() - parseStartedAt;
        if (parsed.stoppedAtLastSeenReviewId) {
          diagnostics.stoppedBecause = "last_seen_review_id_reached";
        }
        diagnostics.totalUniqueCardsSeen = Math.max(
          diagnostics.totalUniqueCardsSeen ?? 0,
          new Set(parsed.reviews.map((review) => review.externalReviewId)).size,
        );
        diagnostics.reviewsExtracted = parsed.reviews.length;
        if (parsed.reviews.length === 0 && parsed.skippedReviews > 0) {
          throw new CrawlError(
            "selector_drift",
            "Google review cards were present, but none contained a usable rating and stable review identity.",
          );
        }

        stage = "mapping";
        const fetchedAt = this.now();
        const mapped = parsed.reviews.map((review) =>
          this.mapper.map(review, resolvedRequest, fetchedAt, parsed.hotelName),
        );
        attemptReviews = mapped.map((review) =>
          canonicalReviewSchema.parse(review),
        );
        const deduplicated = deduplicateReviews(attemptReviews);
        diagnostics.duplicatesRemoved = deduplicated.duplicatesRemoved;
        const cutoff = request.lastSuccessfulCrawlAt
          ? Date.parse(request.lastSuccessfulCrawlAt)
          : undefined;
        const beforeIncrementalFilter = deduplicated.reviews.length;
        const incrementalReviews =
          cutoff === undefined
            ? deduplicated.reviews
            : deduplicated.reviews.filter(
                (review) =>
                  !review.reviewDate ||
                  Date.parse(review.reviewDate) > cutoff,
              );
        if (incrementalReviews.length < beforeIncrementalFilter) {
          diagnostics.stoppedBecause =
            "last_successful_crawl_timestamp";
        }
        attemptReviews = incrementalReviews.slice(0, maxReviews);
        diagnostics.reviewsAccepted = attemptReviews.length;
        await captureDiagnosticScreenshot(session, diagnostics, attempt);
      } catch (error) {
        failure = {
          classification: classifyFailure(error, stage, proxyEnabled),
          message: safeErrorMessage(error),
        };
        if (session) {
          await capturePageMetadata(session.page, diagnostics);
        }
        if (stage === "navigation" || !diagnostics.pageClassification) {
          diagnostics.pageClassification = failure.classification;
        }
        const snapshot = session?.diagnosticSnapshot;
        const shouldCaptureSnapshot =
          process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT === "true" &&
          (attempt === this.maxRetries ||
            !isRetryableFailure(failure.classification)) &&
          Boolean(snapshot);
        if (shouldCaptureSnapshot && session && snapshot) {
          try {
            diagnostics.diagnosticSnapshot = await snapshot.call(session);
          } catch {
            logger.warn(
              { crawlId: diagnostics.crawlId },
              "Google diagnostic snapshot could not be captured",
            );
          }
        }
        if (
          session &&
          (attempt === this.maxRetries ||
            !isRetryableFailure(failure.classification))
        ) {
          await captureDiagnosticScreenshot(session, diagnostics, attempt);
        }
      } finally {
        if (session) {
          diagnostics.abortedResourceTypes = [
            ...new Set([
              ...(diagnostics.abortedResourceTypes ?? []),
              ...(session.abortedResourceTypes?.() ?? []),
            ]),
          ];
          try {
            await session.close();
          } catch (error) {
            failure = {
              classification: "resource_cleanup_failure",
              message: `Browser resources could not be closed: ${safeErrorMessage(error)}`,
            };
            attemptReviews = [];
          }
        }
      }

      if (!failure) {
        diagnostics.failure = undefined;
        diagnostics.finishedAt = this.now().toISOString();
        return { success: true, reviews: attemptReviews, diagnostics };
      }

      if (
        attempt < this.maxRetries &&
        isRetryableFailure(failure.classification)
      ) {
        diagnostics.retries += 1;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            retryDelayMs(diagnostics.retries, this.retryBaseDelayMs),
          ),
        );
        continue;
      }

      diagnostics.failure = failure;
      diagnostics.finishedAt = this.now().toISOString();
      logger.warn(
        {
          crawlId: diagnostics.crawlId,
          source: diagnostics.source,
          failure: failure.classification,
        },
        "Google crawl failed",
      );
      return this.failureResult(diagnostics);
    }

    diagnostics.failure = {
      classification: "navigation_failure",
      message: "Google crawl ended without a result.",
    };
    return this.failureResult(diagnostics);
  }

  private failureResult(diagnostics: CrawlDiagnostics): CrawlResult {
    diagnostics.finishedAt = this.now().toISOString();
    return { success: false, reviews: [], diagnostics };
  }
}
