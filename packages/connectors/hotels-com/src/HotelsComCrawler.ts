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
import {
  deduplicateReviews,
  normalizeDate,
} from "../../../crawler-normalization/src/index.js";
import { HotelsComMapper } from "./HotelsComMapper.js";
import { HotelsComPagination } from "./HotelsComPagination.js";
import { HotelsComParser } from "./HotelsComParser.js";
import {
  HotelsComSelectors as S,
  hotelsComSelectorList,
} from "./HotelsComSelectors.js";

const VERSION = "1.0.0";
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_REVIEWS = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const DEFAULT_PAGE_DELAY_MS = 1_000;

type CrawlStage =
  | "validation"
  | "navigation"
  | "detection"
  | "pagination"
  | "parser"
  | "mapping";

export interface HotelsComCrawlerOptions {
  sessionFactory?: (options: {
    proxyEnabled: boolean;
    locale?: string;
  }) => Promise<BrowserSession>;
  parser?: HotelsComParser;
  mapper?: HotelsComMapper;
  pagination?: HotelsComPagination;
  now?: () => Date;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  pageDelayMs?: number;
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

function isHotelsComHotelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.hostname === "hotels.com" || url.hostname.endsWith(".hotels.com")) &&
      /(?:\/ho\d+(?:\/|$)|\/hotel(?:-information)?\/[^/]+)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function noReviewsPage(text: string): boolean {
  return /(?:no reviews(?: yet)?|there are no reviews|no guest reviews|keine bewertungen|aucun avis|sin comentarios|nessuna recensione|geen beoordelingen|没有住客点评)/i.test(
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
    /captcha|verify you are human|unusual traffic|robot check|challenge page|cloudflare/i.test(
      content,
    )
  ) {
    return new CrawlError(
      "challenge_page",
      "Hotels.com served a challenge page.",
    );
  }
  if (
    /access denied|request blocked|too many requests|forbidden/i.test(content)
  ) {
    return new CrawlError(
      "blocked_page",
      "Hotels.com blocked the public crawl request.",
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
      "Hotels.com served a consent page without review content.",
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
      "Hotels.com requires authentication.",
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
      message: "Hotels.com crawl request is invalid.",
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
      message: "Hotels.com navigation or page processing timed out.",
    };
  }
  if (
    /ENOTFOUND|ECONNRESET|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(raw)
  ) {
    return {
      classification: "network_failure",
      message: "Hotels.com could not be reached because of a network failure.",
    };
  }
  if (stage === "validation") {
    return {
      classification: "invalid_page",
      message: "Hotels.com crawl request is invalid.",
    };
  }
  if (stage === "pagination") {
    return {
      classification: "pagination_failure",
      message: "Hotels.com review pagination failed.",
    };
  }
  if (stage === "parser") {
    return {
      classification: "parser_failure",
      message: "Hotels.com review parsing failed.",
    };
  }
  if (stage === "mapping") {
    return {
      classification: "schema_validation_failure",
      message: "Hotels.com review mapping did not match the canonical schema.",
    };
  }
  return {
    classification:
      stage === "navigation" ? "navigation_failure" : "selector_drift",
    message:
      stage === "navigation"
        ? "Hotels.com navigation failed."
        : "Hotels.com page content could not be classified.",
  };
}

function boundedInteger(
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

function reviewDateIsBefore(
  rawDate: string | undefined,
  cutoff: number | undefined,
  referenceDate: Date,
): boolean {
  if (!rawDate || cutoff === undefined) return false;
  const normalized = normalizeDate(rawDate, referenceDate);
  return normalized !== undefined && Date.parse(normalized) <= cutoff;
}

export class HotelsComCrawler {
  constructor(private readonly options: HotelsComCrawlerOptions = {}) {}

  async crawl(input: CrawlRequest): Promise<CrawlResult> {
    const startedAt = this.options.now?.() ?? new Date();
    const diagnostics: CrawlDiagnostics = {
      crawlId: randomUUID(),
      source: "hotels-com",
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
    let pageDelayMs: number;
    try {
      maxRetries = boundedInteger(
        this.options.maxRetries,
        DEFAULT_RETRIES,
        "maxRetries",
      );
      retryBaseDelayMs = boundedInteger(
        this.options.retryBaseDelayMs,
        DEFAULT_RETRY_BASE_DELAY_MS,
        "retryBaseDelayMs",
      );
      pageDelayMs = boundedInteger(
        this.options.pageDelayMs,
        DEFAULT_PAGE_DELAY_MS,
        "pageDelayMs",
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
      if (!isHotelsComHotelUrl(request.url)) {
        throw new CrawlError(
          "invalid_page",
          "Hotels.com connector requires a Hotels.com hotel URL.",
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
    const proxyEnabled =
      request.proxyEnabled ?? process.env.DECODO_PROXY_ENABLED === "true";
    const canonicalRequest = { ...request, url: safeUrl(request.url) };
    const parser = this.options.parser ?? new HotelsComParser();
    const mapper = this.options.mapper ?? new HotelsComMapper();
    const pagination = this.options.pagination ?? new HotelsComPagination();
    const persistedIds = new Set(request.persistedReviewIds ?? []);
    const lastSeenDate = request.lastSuccessfulCrawlAt
      ? Date.parse(request.lastSuccessfulCrawlAt)
      : undefined;
    diagnostics.maxReviewsPerRun = maxReviews;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let session: BrowserSession | undefined;
      let stage: CrawlStage = "navigation";
      let failure:
        | { classification: CrawlFailureClassification; message: string }
        | undefined;
      let attemptReviews: CanonicalReview[] = [];
      const seenIds = new Set<string>();
      const candidateReviews: CanonicalReview[] = [];

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
        diagnostics.pagesVisited = 1;
        diagnostics.finalUrl = safeUrl(session.page.url());
        diagnostics.documentTitle = await session.page.title();
        diagnostics.navigationStatus = response?.status?.();

        if (diagnostics.navigationStatus === 401) {
          throw new CrawlError(
            "authentication_required",
            "Hotels.com requires authentication.",
          );
        }
        if (
          diagnostics.navigationStatus === 403 ||
          diagnostics.navigationStatus === 429
        ) {
          throw new CrawlError(
            "blocked_page",
            `Hotels.com returned HTTP ${diagnostics.navigationStatus}.`,
          );
        }
        if (
          diagnostics.navigationStatus !== undefined &&
          diagnostics.navigationStatus >= 400
        ) {
          throw new CrawlError(
            "navigation_failure",
            `Hotels.com returned HTTP ${diagnostics.navigationStatus}.`,
          );
        }

        let totalExtracted = 0;
        let stopped = false;
        stage = "detection";

        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          const pageText = await session.page.locator("body").innerText();
          const cardCount = await session.page
            .locator(hotelsComSelectorList(S.reviewCards))
            .count();
          diagnostics.reviewCardCount = cardCount;

          const protection = protectionForPage(
            pageText,
            diagnostics.documentTitle ?? "",
            cardCount > 0,
          );
          if (protection) throw protection;

          if (cardCount === 0 && !noReviewsPage(pageText)) {
            const hotelTitleCount = await session.page
              .locator(hotelsComSelectorList(S.hotelName))
              .count();
            if (hotelTitleCount === 0) {
              throw new CrawlError(
                "invalid_page",
                "The page did not contain recognizable Hotels.com hotel content.",
              );
            }
          }

          stage = "parser";
          const parsed = await parser.parse(session.page, request.url);
          let newCardsOnPage = 0;
          const fetchedAt = this.options.now?.() ?? new Date();

          for (const review of parsed) {
            if (seenIds.has(review.externalReviewId)) {
              diagnostics.duplicatesRemoved += 1;
              continue;
            }
            seenIds.add(review.externalReviewId);
            newCardsOnPage += 1;
            totalExtracted += 1;
            diagnostics.reviewsExtracted = totalExtracted;

            if (request.lastSeenReviewId === review.externalReviewId) {
              diagnostics.stoppedBecause = "last_seen_review_id";
              stopped = true;
              break;
            }
            if (
              persistedIds.has(review.externalReviewId) ||
              reviewDateIsBefore(review.rawDate, lastSeenDate, fetchedAt)
            ) {
              continue;
            }

            stage = "mapping";
            candidateReviews.push(
              mapper.map(
                review,
                canonicalRequest,
                fetchedAt,
                request.hotel?.name,
              ),
            );
            if (candidateReviews.length >= maxReviews) {
              diagnostics.stoppedBecause = "max_reviews";
              stopped = true;
              break;
            }
          }
          if (stopped) break;

          if (pageNumber > 1 && newCardsOnPage === 0) {
            diagnostics.stoppedBecause = "no_progress";
            stopped = true;
            break;
          }
          if (pageNumber >= maxPages) {
            diagnostics.stoppedBecause = "max_pages";
            break;
          }

          stage = "pagination";
          if (!(await pagination.next(session.page))) {
            diagnostics.stoppedBecause = noReviewsPage(pageText)
              ? "no_reviews"
              : "no_next_page_control";
            break;
          }
          await session.page.waitForTimeout(pageDelayMs);
          diagnostics.pagesVisited += 1;
          diagnostics.finalUrl = safeUrl(session.page.url());
          diagnostics.documentTitle = await session.page.title();
          stage = "detection";
        }

        if (
          totalExtracted === 0 &&
          diagnostics.stoppedBecause !== "no_reviews"
        ) {
          const pageText = await session.page.locator("body").innerText();
          if (!noReviewsPage(pageText)) {
            throw new CrawlError(
              "selector_drift",
              "Hotels.com did not render recognizable hotel reviews.",
            );
          }
        }

        stage = "mapping";
        const deduplicated = deduplicateReviews(candidateReviews);
        attemptReviews = deduplicated.reviews;
        diagnostics.duplicatesRemoved += deduplicated.duplicatesRemoved;
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
              message: "Hotels.com browser resources could not be closed.",
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
      message: "Hotels.com crawl ended without a result.",
    };
    return { success: false, reviews: [], diagnostics };
  }
}
