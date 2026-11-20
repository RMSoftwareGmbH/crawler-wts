import { randomUUID } from "node:crypto";
import { crawlRequestSchema } from "../../../crawler-contracts/src/index.js";
import {
  createBrowserSession,
  CrawlError,
  type BrowserSession,
  type CrawlDiagnostics,
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

function classificationForPage(
  text: string,
  title: string,
): CrawlError | undefined {
  const content = `${title}\n${text}`;
  if (
    /captcha|verify you are human|unusual traffic|robot check|challenge/i.test(
      content,
    )
  ) {
    return new CrawlError(
      "challenge_page",
      "Tripadvisor served a challenge page.",
    );
  }
  if (
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
    /sign in|log in|authentication required/i.test(content) &&
    !/review/i.test(content)
  ) {
    return new CrawlError(
      "authentication_required",
      "Tripadvisor requires authentication.",
    );
  }
  return undefined;
}

export class TripadvisorCrawler {
  private readonly options: TripadvisorCrawlerOptions;
  constructor(options: TripadvisorCrawlerOptions = {}) {
    this.options = options;
  }

  async crawl(input: CrawlRequest): Promise<CrawlResult> {
    const startedAt = this.options.now?.() ?? new Date();
    const crawlId = randomUUID();
    const diagnostics: CrawlDiagnostics = {
      crawlId,
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
    let session: BrowserSession | undefined;
    try {
      const request = crawlRequestSchema.parse(input);
      const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
      const maxReviews = request.maxReviews ?? DEFAULT_MAX_REVIEWS;
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      diagnostics.maxReviewsPerRun = maxReviews;
      session = this.options.sessionFactory
        ? await this.options.sessionFactory({
            proxyEnabled: request.proxyEnabled ?? false,
            locale: request.locale,
          })
        : await createBrowserSession({
            proxyEnabled: request.proxyEnabled ?? false,
            locale: request.locale,
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
      if (
        diagnostics.navigationStatus === 403 ||
        diagnostics.navigationStatus === 429
      ) {
        throw new CrawlError(
          "blocked_page",
          `Tripadvisor returned HTTP ${diagnostics.navigationStatus}.`,
        );
      }
      const pageText = await session.page.locator("body").innerText();
      const protection = classificationForPage(
        pageText,
        diagnostics.documentTitle ?? "",
      );
      if (protection) throw protection;
      const parser = this.options.parser ?? new TripadvisorParser();
      const pagination = this.options.pagination ?? new TripadvisorPagination();
      const mapper = this.options.mapper ?? new TripadvisorMapper();
      diagnostics.reviewCardCountBeforeClick = await session.page
        .locator(selectorList(S.reviewCards))
        .count();
      const paginationResult = await pagination.run(session.page, {
        maxPages,
        maxReviews,
        waitMs: this.options.delayMs,
      });
      diagnostics.pagesVisited = paginationResult.pagesVisited;
      diagnostics.paginationStoppedBecause = paginationResult.stoppedBecause;
      const parsed = (await parser.parse(session.page, request.url)).slice(
        0,
        maxReviews,
      );
      diagnostics.reviewCardCount = parsed.length;
      diagnostics.reviewsExtracted = parsed.length;
      const mapped = parsed.map((review) =>
        mapper.map(
          review,
          request,
          this.options.now?.() ?? new Date(),
          request.hotel?.name,
        ),
      );
      const deduplicated = deduplicateReviews(mapped);
      diagnostics.duplicatesRemoved = deduplicated.duplicatesRemoved;
      diagnostics.reviewsAccepted = deduplicated.reviews.length;
      diagnostics.finishedAt = (
        this.options.now?.() ?? new Date()
      ).toISOString();
      return { success: true, reviews: deduplicated.reviews, diagnostics };
    } catch (error) {
      const failure =
        error instanceof CrawlError
          ? error
          : new CrawlError(
              "navigation_failure",
              error instanceof Error
                ? error.message
                : "Tripadvisor crawl failed.",
            );
      diagnostics.failure = {
        classification: failure.classification,
        message: failure.message.slice(0, 500),
      };
      diagnostics.pageClassification = failure.classification;
      diagnostics.consentPageDetected =
        failure.classification === "consent_page";
      diagnostics.challengePageDetected =
        failure.classification === "challenge_page";
      diagnostics.authenticationPageDetected =
        failure.classification === "authentication_required";
      diagnostics.finishedAt = (
        this.options.now?.() ?? new Date()
      ).toISOString();
      return { success: false, reviews: [], diagnostics };
    } finally {
      await session?.close();
    }
  }
}
