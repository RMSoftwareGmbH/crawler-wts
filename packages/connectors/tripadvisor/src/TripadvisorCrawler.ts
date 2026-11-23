import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  crawlRequestSchema,
  type CanonicalReview,
} from "../../../crawler-contracts/src/index.js";
import {
  createBrowserSession,
  CrawlError,
  isRetryableFailure,
  retryDelayMs,
  type BrowserSession,
  type CrawlDiagnostics,
  type CrawlFailureClassification,
  type CrawlRequest,
  type CrawlResult,
} from "../../../crawler-core/src/index.js";
import { deduplicateReviews } from "../../../crawler-normalization/src/index.js";
import { TripadvisorMapper } from "./TripadvisorMapper.js";
import { TripadvisorPagination } from "./TripadvisorPagination.js";
import { TripadvisorParser } from "./TripadvisorParser.js";
import {
  TripadvisorSelectors as S,
  selectorList,
} from "./TripadvisorSelectors.js";

const VERSION = "1.0.0";
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_REVIEWS = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const DEFAULT_PAGINATION_DELAY_MS = 1_000;

type CrawlStage =
  | "validation"
  | "navigation"
  | "detection"
  | "pagination"
  | "parser"
  | "mapping";

export interface TripadvisorCrawlerOptions {
  sessionFactory?: (options: {
    proxyEnabled: boolean;
    locale?: string;
  }) => Promise<BrowserSession>;
  parser?: TripadvisorParser;
  mapper?: TripadvisorMapper;
  pagination?: TripadvisorPagination;
  now?: () => Date;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  delayMs?: number;
}

function safeUrl(value: string): string {
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

function isTripadvisorHotelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      /(^|\.)tripadvisor\.[a-z.]+$/i.test(url.hostname) &&
      /\/Hotel_Review(?:-|\/|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function noReviewsPage(text: string): boolean {
  return /(?:no reviews|0 reviews|no reviews yet|keine bewertungen|keine rezensionen|aucun avis|pas d'avis)/i.test(
    text,
  );
}

function protectionForPage(
  text: string,
  title: string,
  hasReviewCards: boolean,
): CrawlError | undefined {
  const content = `${title}\n${text}`;
  if (
    /captcha|datadome|verify you are human|unusual traffic|robot check|challenge/i.test(
      content,
    )
  ) {
    return new CrawlError(
      "challenge_page",
      "Tripadvisor served a challenge page.",
    );
  }
  if (
    /access denied|request blocked|too many requests|forbidden/i.test(content)
  ) {
    return new CrawlError(
      "blocked_page",
      "Tripadvisor blocked the public crawl request.",
    );
  }
  if (
    !hasReviewCards &&
    /accept cookies|cookie consent|consent preferences|we use cookies/i.test(
      content,
    )
  ) {
    return new CrawlError(
      "consent_page",
      "Tripadvisor served a consent page without review content.",
    );
  }
  if (
    !hasReviewCards &&
    /sign in to continue|log in to continue|authentication required|please sign in to view/i.test(
      content,
    )
  ) {
    return new CrawlError(
      "authentication_required",
      "Tripadvisor requires authentication.",
    );
  }
  return undefined;
}

function sanitizeFailureMessage(message: string): string {
  return message
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[database URI]")
    .replace(/https?:\/\/[^\s)"'<>]+/gi, "[URL]")
    .replace(
      /((?:password|token|cookie|authorization|secret|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi,
      "$1[redacted]",
    )
    .slice(0, 500);
}

function failureFor(
  error: unknown,
  stage: CrawlStage,
  proxyEnabled: boolean,
): { classification: CrawlFailureClassification; message: string } {
  if (error instanceof CrawlError) {
    return {
      classification: error.classification,
      message: sanitizeFailureMessage(error.message),
    };
  }
  if (error instanceof ZodError) {
    return {
      classification: "invalid_page",
      message: "Tripadvisor crawl request is invalid.",
    };
  }
  const raw = error instanceof Error ? error.message : "";
  if (proxyEnabled && /proxy|tunnel|ERR_PROXY|ECONNREFUSED/i.test(raw)) {
    return {
      classification: "proxy_failure",
      message: "The configured proxy connection failed.",
    };
  }
  if (/timeout|timed out/i.test(raw)) {
    return {
      classification: "timeout",
      message: "Tripadvisor navigation or page processing timed out.",
    };
  }
  if (
    /ENOTFOUND|ECONNRESET|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(raw)
  ) {
    return {
      classification: "network_failure",
      message: "Tripadvisor could not be reached because of a network failure.",
    };
  }
  if (stage === "validation") {
    return {
      classification: "invalid_page",
      message: "Tripadvisor crawl request is invalid.",
    };
  }
  if (stage === "pagination") {
    return {
      classification: "pagination_failure",
      message: "Tripadvisor pagination failed.",
    };
  }
  if (stage === "parser") {
    return {
      classification: "parser_failure",
      message: "Tripadvisor review parsing failed.",
    };
  }
  if (stage === "mapping") {
    return {
      classification: "schema_validation_failure",
      message: "Tripadvisor review mapping did not match the canonical schema.",
    };
  }
  return {
    classification:
      stage === "navigation" ? "navigation_failure" : "selector_drift",
    message:
      stage === "navigation"
        ? "Tripadvisor navigation failed."
        : "Tripadvisor page content could not be classified.",
  };
}

function retryConfiguration(
  value: number | undefined,
  defaultValue: number,
  name: string,
): number {
  const result = value ?? defaultValue;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new CrawlError(
      "configuration_failure",
      `${name} must be a non-negative integer.`,
    );
  }
  return result;
}

export class TripadvisorCrawler {
  constructor(private readonly options: TripadvisorCrawlerOptions = {}) {}

  async crawl(input: CrawlRequest): Promise<CrawlResult> {
    const startedAt = this.options.now?.() ?? new Date();
    const diagnostics: CrawlDiagnostics = {
      crawlId: randomUUID(),
      source: "tripadvisor",
      hotelUrl: safeUrl(input.url),
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      pagesVisited: 0,
      reviewsExtracted: 0,
      reviewsAccepted: 0,
      duplicatesRemoved: 0,
      retries: 0,
      crawlerVersion: VERSION,
      consentPageDetected: false,
      challengePageDetected: false,
      authenticationPageDetected: false,
      restrictedMapsViewDetected: false,
    };

    let maxRetries: number;
    let retryBaseDelayMs: number;
    let delayMs: number;
    try {
      maxRetries = retryConfiguration(
        this.options.maxRetries,
        DEFAULT_RETRIES,
        "maxRetries",
      );
      retryBaseDelayMs = retryConfiguration(
        this.options.retryBaseDelayMs,
        DEFAULT_RETRY_BASE_DELAY_MS,
        "retryBaseDelayMs",
      );
      delayMs = retryConfiguration(
        this.options.delayMs,
        DEFAULT_PAGINATION_DELAY_MS,
        "delayMs",
      );
    } catch (error) {
      const failure = failureFor(error, "validation", false);
      diagnostics.failure = failure;
      diagnostics.pageClassification = failure.classification;
      diagnostics.finishedAt = (
        this.options.now?.() ?? new Date()
      ).toISOString();
      return { success: false, reviews: [], diagnostics };
    }

    let request: CrawlRequest;
    try {
      request = crawlRequestSchema.parse(input);
      if (!isTripadvisorHotelUrl(request.url)) {
        throw new CrawlError(
          "invalid_page",
          "Tripadvisor connector requires a Tripadvisor hotel-review URL.",
        );
      }
    } catch (error) {
      const failure = failureFor(error, "validation", false);
      diagnostics.failure = failure;
      diagnostics.pageClassification = failure.classification;
      diagnostics.finishedAt = (
        this.options.now?.() ?? new Date()
      ).toISOString();
      return { success: false, reviews: [], diagnostics };
    }

    const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
    const maxReviews = request.maxReviews ?? DEFAULT_MAX_REVIEWS;
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const canonicalRequest = { ...request, url: safeUrl(request.url) };
    const proxyEnabled =
      request.proxyEnabled ?? process.env.DECODO_PROXY_ENABLED === "true";
    diagnostics.maxReviewsPerRun = maxReviews;
    const parser = this.options.parser ?? new TripadvisorParser();
    const pagination = this.options.pagination ?? new TripadvisorPagination();
    const mapper = this.options.mapper ?? new TripadvisorMapper();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let session: BrowserSession | undefined;
      let stage: CrawlStage = "navigation";
      let failure:
        | { classification: CrawlFailureClassification; message: string }
        | undefined;
      let attemptReviews: CanonicalReview[] = [];

      try {
        session = this.options.sessionFactory
          ? await this.options.sessionFactory({
              proxyEnabled,
              ...(request.locale ? { locale: request.locale } : {}),
            })
          : await createBrowserSession({
              proxyEnabled,
              ...(request.locale ? { locale: request.locale } : {}),
            });

        const navigationStarted = Date.now();
        const response = (await session.page.goto(request.url, {
          timeout: timeoutMs,
          waitUntil: "domcontentloaded",
        })) as { status?: () => number } | undefined;
        diagnostics.navigationMs = Date.now() - navigationStarted;
        diagnostics.pagesVisited += 1;
        diagnostics.finalUrl = safeUrl(session.page.url());
        diagnostics.documentTitle = await session.page.title();
        diagnostics.navigationStatus = response?.status?.();

        const status = diagnostics.navigationStatus;
        if (status === 401) {
          throw new CrawlError(
            "authentication_required",
            "Tripadvisor requires authentication.",
          );
        }
        if (status === 403 || status === 429) {
          throw new CrawlError(
            "blocked_page",
            `Tripadvisor returned HTTP ${status}.`,
          );
        }
        if (status !== undefined && status >= 400) {
          throw new CrawlError(
            "navigation_failure",
            `Tripadvisor returned HTTP ${status}.`,
          );
        }

        stage = "detection";
        const pageText = await session.page.locator("body").innerText();
        const cardCount = await session.page
          .locator(selectorList(S.reviewCards))
          .count();
        diagnostics.reviewCardCountBeforeClick = cardCount;
        const protection = protectionForPage(
          pageText,
          diagnostics.documentTitle ?? "",
          cardCount > 0,
        );
        if (protection) {
          throw protection;
        }

        stage = "pagination";
        const paginationResult = await pagination.run(session.page, {
          maxPages,
          maxReviews,
          waitMs: delayMs,
        });
        diagnostics.pagesVisited += paginationResult.pagesVisited - 1;
        diagnostics.paginationStoppedBecause = paginationResult.stoppedBecause;
        const cardsAfterPagination = await session.page
          .locator(selectorList(S.reviewCards))
          .count();

        stage = "parser";
        const parsed = await parser.parse(session.page, request.url);
        diagnostics.reviewCardCount = cardsAfterPagination;
        diagnostics.reviewsExtracted = parsed.length;
        if (parsed.length === 0 && !noReviewsPage(pageText)) {
          throw new CrawlError(
            "selector_drift",
            cardsAfterPagination > 0
              ? "Tripadvisor review cards contained no usable ratings."
              : "Tripadvisor did not render recognizable hotel reviews.",
          );
        }

        stage = "mapping";
        const fetchedAt = this.options.now?.() ?? new Date();
        const mapped = parsed
          .slice(0, maxReviews)
          .map((review) =>
            mapper.map(
              review,
              canonicalRequest,
              fetchedAt,
              request.hotel?.name,
            ),
          );
        const deduplicated = deduplicateReviews(mapped);
        attemptReviews = deduplicated.reviews;
        diagnostics.duplicatesRemoved = deduplicated.duplicatesRemoved;
        diagnostics.reviewsAccepted = attemptReviews.length;
        diagnostics.pageClassification = "valid";
      } catch (error) {
        failure = failureFor(error, stage, proxyEnabled);
        diagnostics.pageClassification = failure.classification;
        diagnostics.failure = failure;
        diagnostics.challengePageDetected =
          failure.classification === "challenge_page";
        diagnostics.consentPageDetected =
          failure.classification === "consent_page";
        diagnostics.authenticationPageDetected =
          failure.classification === "authentication_required";
      } finally {
        if (session) {
          try {
            await session.close();
          } catch {
            failure = {
              classification: "resource_cleanup_failure",
              message: "Tripadvisor browser resources could not be closed.",
            };
            diagnostics.pageClassification = failure.classification;
            attemptReviews = [];
          }
        }
      }

      if (!failure) {
        diagnostics.failure = undefined;
        diagnostics.finishedAt = (
          this.options.now?.() ?? new Date()
        ).toISOString();
        return { success: true, reviews: attemptReviews, diagnostics };
      }
      if (attempt < maxRetries && isRetryableFailure(failure.classification)) {
        diagnostics.retries += 1;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            retryDelayMs(diagnostics.retries, retryBaseDelayMs),
          ),
        );
        continue;
      }

      diagnostics.failure = failure;
      diagnostics.finishedAt = (
        this.options.now?.() ?? new Date()
      ).toISOString();
      return { success: false, reviews: [], diagnostics };
    }

    diagnostics.finishedAt = (this.options.now?.() ?? new Date()).toISOString();
    diagnostics.failure = {
      classification: "navigation_failure",
      message: "Tripadvisor crawl ended without a result.",
    };
    return { success: false, reviews: [], diagnostics };
  }
}
