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
  type CrawlerLocator,
  type CrawlerPage,
} from "../../../crawler-core/src/index.js";
import {
  deduplicateReviews,
  normalizeDate,
} from "../../../crawler-normalization/src/index.js";
import { BookingMapper } from "./BookingMapper.js";
import { BookingPagination } from "./BookingPagination.js";
import { BookingParser } from "./BookingParser.js";
import { BookingReviewInteraction } from "./BookingReviewInteraction.js";
import {
  BookingSelectors as S,
  bookingSelectorList,
} from "./BookingSelectors.js";

const VERSION = "1.0.0";
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_REVIEWS = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const DEFAULT_PAGE_DELAY_MS = 1_000;
const MAX_CONTENT_READY_WAIT_MS = 3_000;
const CONTENT_READY_POLL_MS = 150;
const MAX_PAGINATION_WAIT_MS = 1_500;

type CrawlStage =
  | "validation"
  | "navigation"
  | "detection"
  | "interaction"
  | "pagination"
  | "parser"
  | "mapping";

export interface BookingCrawlerOptions {
  sessionFactory?: (options: {
    proxyEnabled: boolean;
    locale?: string;
    optimizationEnabled: false;
  }) => Promise<BrowserSession>;
  parser?: BookingParser;
  mapper?: BookingMapper;
  pagination?: BookingPagination;
  reviewInteraction?: BookingReviewInteraction;
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

function safeTitle(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeUrl(url))
    .replace(/\s+/g, " ")
    .trim();
}

function isBookingHotelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.hostname === "booking.com" ||
        url.hostname.endsWith(".booking.com")) &&
      /\/hotel\/[^/]+\/[^/]+/i.test(url.pathname)
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
    /captcha|verify you are human|unusual traffic|robot check|challenge page|cloudflare|datadome|security check|verify your browser|checking your browser|enable javascript and cookies|\bchal_t=/i.test(
      content,
    )
  ) {
    return new CrawlError(
      "challenge_page",
      "Booking.com served a challenge page.",
    );
  }
  if (
    /access denied|request blocked|too many requests|forbidden/i.test(content)
  ) {
    return new CrawlError(
      "blocked_page",
      "Booking.com blocked the public crawl request.",
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
      "Booking.com served a consent page without review content.",
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
      "Booking.com requires authentication.",
    );
  }
  return undefined;
}

interface BookingPageSnapshot {
  title: string;
  bodyText: string;
  bodyTextLength: number;
  hotelContentMarkerCount: number;
  reviewCardCount: number;
  protection?: CrawlError;
}

async function inspectBookingPage(
  page: CrawlerPage,
): Promise<BookingPageSnapshot> {
  const [title, bodyText, hotelNameCount, reviewCardCount, noReviewsCount] =
    await Promise.all([
      page.title(),
      page.locator("body").innerText(),
      page.locator(bookingSelectorList(S.hotelName)).count(),
      page.locator(bookingSelectorList(S.reviewCards)).count(),
      page.locator(bookingSelectorList(S.noReviews)).count(),
    ]);
  return {
    title: safeTitle(title),
    bodyText,
    bodyTextLength: bodyText.length,
    hotelContentMarkerCount: hotelNameCount + reviewCardCount + noReviewsCount,
    reviewCardCount,
    protection: protectionForPage(bodyText, title, reviewCardCount > 0),
  };
}

async function waitForBookingContent(
  page: CrawlerPage,
  timeoutMs: number,
): Promise<BookingPageSnapshot> {
  const waitBudgetMs = Math.min(MAX_CONTENT_READY_WAIT_MS, timeoutMs);
  const deadline = Date.now() + waitBudgetMs;
  let scheduledWaitMs = 0;
  let previousMarkerCount = -1;
  let stableMarkerObservations = 0;
  let snapshot = await inspectBookingPage(page);

  while (true) {
    if (snapshot.protection) return snapshot;

    const hasHotelContent =
      snapshot.hotelContentMarkerCount > 0 || noReviewsPage(snapshot.bodyText);
    if (hasHotelContent) {
      stableMarkerObservations =
        snapshot.hotelContentMarkerCount === previousMarkerCount
          ? stableMarkerObservations + 1
          : 1;
      if (stableMarkerObservations >= 2) return snapshot;
    } else {
      stableMarkerObservations = 0;
    }
    previousMarkerCount = snapshot.hotelContentMarkerCount;

    const remainingMs = Math.min(
      waitBudgetMs - scheduledWaitMs,
      deadline - Date.now(),
    );
    if (remainingMs <= 0) return snapshot;
    const delayMs = Math.min(CONTENT_READY_POLL_MS, remainingMs);
    await page.waitForTimeout(delayMs);
    scheduledWaitMs += delayMs;
    snapshot = await inspectBookingPage(page);
  }
}

async function reviewPanelSignature(panel: CrawlerLocator): Promise<string> {
  const cards = panel.locator(bookingSelectorList(S.reviewCards));
  const signatures: string[] = [];
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    signatures.push(
      `${(await card.getAttribute("data-review-id")) ?? ""}|${await card.innerText()}`,
    );
  }
  return JSON.stringify(signatures);
}

async function waitForReviewPanelProgress(
  page: CrawlerPage,
  panel: CrawlerLocator,
  previousSignature: string,
  timeoutMs: number,
): Promise<void> {
  const waitBudgetMs = Math.min(MAX_PAGINATION_WAIT_MS, Math.max(0, timeoutMs));
  const deadline = Date.now() + waitBudgetMs;
  let scheduledWaitMs = 0;

  while (scheduledWaitMs < waitBudgetMs && Date.now() < deadline) {
    const remainingMs = Math.min(
      waitBudgetMs - scheduledWaitMs,
      deadline - Date.now(),
    );
    if (remainingMs <= 0) return;
    const delayMs = Math.min(CONTENT_READY_POLL_MS, remainingMs);
    await page.waitForTimeout(delayMs);
    scheduledWaitMs += delayMs;
    if ((await reviewPanelSignature(panel)) !== previousSignature) return;
  }
}

function recordProtectionDiagnostics(
  diagnostics: CrawlDiagnostics,
  classification: CrawlFailureClassification,
): void {
  diagnostics.challengePageDetected = classification === "challenge_page";
  diagnostics.consentPageDetected = classification === "consent_page";
  diagnostics.authenticationPageDetected =
    classification === "authentication_required";
  diagnostics.interstitialPageDetected = [
    "blocked_page",
    "challenge_page",
    "consent_page",
    "authentication_required",
  ].includes(classification);
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
      message: "Booking.com crawl request is invalid.",
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
      message: "Booking.com navigation or page processing timed out.",
    };
  }
  if (
    /ENOTFOUND|ECONNRESET|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(raw)
  ) {
    return {
      classification: "network_failure",
      message: "Booking.com could not be reached because of a network failure.",
    };
  }
  if (stage === "validation") {
    return {
      classification: "invalid_page",
      message: "Booking.com crawl request is invalid.",
    };
  }
  if (stage === "pagination") {
    return {
      classification: "pagination_failure",
      message: "Booking.com review pagination failed.",
    };
  }
  if (stage === "interaction") {
    return {
      classification: "interaction_failure",
      message: "Booking.com review interaction failed.",
    };
  }
  if (stage === "parser") {
    return {
      classification: "parser_failure",
      message: "Booking.com review parsing failed.",
    };
  }
  if (stage === "mapping") {
    return {
      classification: "schema_validation_failure",
      message: "Booking.com review mapping did not match the canonical schema.",
    };
  }
  return {
    classification:
      stage === "navigation" ? "navigation_failure" : "selector_drift",
    message:
      stage === "navigation"
        ? "Booking.com navigation failed."
        : "Booking.com page content could not be classified.",
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

export class BookingCrawler {
  constructor(private readonly options: BookingCrawlerOptions = {}) {}

  async crawl(input: CrawlRequest): Promise<CrawlResult> {
    const startedAt = this.options.now?.() ?? new Date();
    const diagnostics: CrawlDiagnostics = {
      crawlId: randomUUID(),
      source: "booking",
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
      guestReviewsControlFound: false,
      guestReviewsControlClicked: false,
      reviewPanelFound: false,
      reviewCardCountBeforeClick: 0,
      reviewCardCountAfterClick: 0,
      paginationControlFound: false,
      paginationClicks: 0,
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
      if (!isBookingHotelUrl(request.url)) {
        throw new CrawlError(
          "invalid_page",
          "Booking connector requires a Booking.com hotel URL.",
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
    const parser = this.options.parser ?? new BookingParser();
    const mapper = this.options.mapper ?? new BookingMapper();
    const pagination = this.options.pagination ?? new BookingPagination();
    const reviewInteraction =
      this.options.reviewInteraction ?? new BookingReviewInteraction();
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
              optimizationEnabled: false,
            })
          : await createBrowserSession({
              proxyEnabled,
              ...(request.locale ? { locale: request.locale } : {}),
              optimizationEnabled: false,
            });

        const navigationStarted = Date.now();
        const response = (await session.page.goto(request.url, {
          timeout: timeoutMs,
          waitUntil: "domcontentloaded",
        })) as { status?: () => number } | undefined;
        diagnostics.navigationMs = Date.now() - navigationStarted;
        diagnostics.pagesVisited = 1;
        diagnostics.finalUrl = safeUrl(session.page.url());
        diagnostics.documentTitle = safeTitle(await session.page.title());
        diagnostics.navigationStatus = response?.status?.();
        diagnostics.interstitialPageDetected = false;
        const initialSnapshot = await inspectBookingPage(session.page);
        diagnostics.bodyTextLength = initialSnapshot.bodyTextLength;
        diagnostics.hotelContentMarkerCount =
          initialSnapshot.hotelContentMarkerCount;
        diagnostics.reviewCardCount = initialSnapshot.reviewCardCount;

        if (diagnostics.navigationStatus === 401) {
          throw new CrawlError(
            "authentication_required",
            "Booking.com requires authentication.",
          );
        }
        if (
          diagnostics.navigationStatus === 403 ||
          diagnostics.navigationStatus === 429
        ) {
          throw new CrawlError(
            "blocked_page",
            `Booking.com returned HTTP ${diagnostics.navigationStatus}.`,
          );
        }
        if (
          diagnostics.navigationStatus !== undefined &&
          diagnostics.navigationStatus >= 400
        ) {
          throw new CrawlError(
            "navigation_failure",
            `Booking.com returned HTTP ${diagnostics.navigationStatus}.`,
          );
        }

        const pageSnapshot = await waitForBookingContent(
          session.page,
          Math.max(0, timeoutMs - (Date.now() - navigationStarted)),
        );
        diagnostics.documentTitle = pageSnapshot.title;
        diagnostics.bodyTextLength = pageSnapshot.bodyTextLength;
        diagnostics.hotelContentMarkerCount =
          pageSnapshot.hotelContentMarkerCount;
        diagnostics.reviewCardCount = pageSnapshot.reviewCardCount;
        if (pageSnapshot.protection) {
          recordProtectionDiagnostics(
            diagnostics,
            pageSnapshot.protection.classification,
          );
          throw pageSnapshot.protection;
        }

        if (
          pageSnapshot.hotelContentMarkerCount === 0 &&
          !noReviewsPage(pageSnapshot.bodyText)
        ) {
          if (
            diagnostics.navigationStatus === 202 &&
            pageSnapshot.bodyTextLength === 0 &&
            pageSnapshot.title.length === 0
          ) {
            throw new CrawlError(
              "navigation_failure",
              "Booking.com returned an empty HTTP 202 response without usable page content.",
            );
          }
          throw new CrawlError(
            "invalid_page",
            "The page did not contain recognizable Booking.com hotel content.",
          );
        }

        stage = "interaction";
        const interactionResult = await reviewInteraction.open(
          session.page,
          Math.max(0, timeoutMs - (Date.now() - navigationStarted)),
        );
        diagnostics.guestReviewsControlFound =
          interactionResult.guestReviewsControlFound;
        diagnostics.guestReviewsControlClicked =
          interactionResult.guestReviewsControlClicked;
        diagnostics.reviewPanelFound = interactionResult.reviewPanelFound;
        diagnostics.reviewPanelSelector = interactionResult.reviewPanelSelector;
        diagnostics.reviewCardCountBeforeClick =
          interactionResult.reviewCardCountBeforeClick;
        diagnostics.reviewCardCountAfterClick =
          interactionResult.reviewCardCountAfterClick;
        diagnostics.reviewCardCount =
          interactionResult.reviewCardCountAfterClick;
        diagnostics.interactionStoppedBecause =
          interactionResult.interactionStoppedBecause;
        if (interactionResult.failure) throw interactionResult.failure;
        const reviewPanel = interactionResult.panel;
        if (!reviewPanel) {
          diagnostics.interactionStoppedBecause ??= "review_panel_unavailable";
          throw new CrawlError(
            "interaction_failure",
            "Booking.com review panel was not available after interaction.",
          );
        }

        let totalExtracted = 0;
        let stopped = false;
        stage = "detection";

        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          const pageText = await reviewPanel.innerText();
          const cardCount = await reviewPanel
            .locator(bookingSelectorList(S.reviewCards))
            .count();
          diagnostics.reviewCardCount = cardCount;

          const protection = protectionForPage(
            pageText,
            diagnostics.documentTitle ?? "",
            cardCount > 0,
          );
          if (protection) throw protection;

          if (cardCount === 0 && noReviewsPage(pageText)) {
            diagnostics.interactionStoppedBecause = "no_reviews_available";
            throw new CrawlError(
              "no_reviews_available",
              "Booking.com review panel reports no available reviews.",
            );
          }
          if (cardCount === 0) {
            diagnostics.interactionStoppedBecause = "review_panel_has_no_cards";
            throw new CrawlError(
              "selector_drift",
              "Booking.com review panel contained no recognizable review cards.",
            );
          }

          stage = "parser";
          const parsed = await parser.parse(
            session.page,
            request.url,
            reviewPanel,
          );
          totalExtracted += parsed.length;
          diagnostics.reviewsExtracted = totalExtracted;
          let newCardsOnPage = 0;
          const fetchedAt = this.options.now?.() ?? new Date();

          for (const review of parsed) {
            if (seenIds.has(review.externalReviewId)) {
              diagnostics.duplicatesRemoved += 1;
              continue;
            }
            seenIds.add(review.externalReviewId);
            newCardsOnPage += 1;
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
            diagnostics.paginationStoppedBecause = "no_progress";
            diagnostics.interactionStoppedBecause = "pagination_no_progress";
            stopped = true;
            break;
          }
          if (pageNumber >= maxPages) {
            diagnostics.stoppedBecause = "max_pages";
            diagnostics.paginationStoppedBecause = "max_pages";
            break;
          }

          stage = "pagination";
          const remainingTimeoutMs = Math.max(
            0,
            timeoutMs - (Date.now() - navigationStarted),
          );
          if (remainingTimeoutMs <= 0) {
            throw new CrawlError(
              "timeout",
              "Booking.com crawl exceeded its configured timeout.",
            );
          }
          const previousPanelSignature =
            await reviewPanelSignature(reviewPanel);
          const paginationResult = await pagination.next(
            reviewPanel,
            remainingTimeoutMs,
          );
          diagnostics.paginationControlFound ||= paginationResult.controlFound;
          if (!paginationResult.clicked) {
            diagnostics.stoppedBecause = paginationResult.controlFound
              ? "pagination_control_disabled"
              : "no_next_page_control";
            diagnostics.paginationStoppedBecause = diagnostics.stoppedBecause;
            break;
          }
          diagnostics.paginationClicks =
            (diagnostics.paginationClicks ?? 0) + 1;
          const paginationWaitMs = Math.min(
            pageDelayMs,
            Math.max(0, timeoutMs - (Date.now() - navigationStarted)),
          );
          await waitForReviewPanelProgress(
            session.page,
            reviewPanel,
            previousPanelSignature,
            paginationWaitMs,
          );
          diagnostics.pagesVisited += 1;
          stage = "detection";
        }

        if (totalExtracted === 0) {
          diagnostics.interactionStoppedBecause = "review_cards_unparsed";
          throw new CrawlError(
            "selector_drift",
            "Booking.com review cards were present but could not be parsed.",
          );
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
        diagnostics.interstitialPageDetected = [
          "blocked_page",
          "challenge_page",
          "consent_page",
          "authentication_required",
        ].includes(failure.classification);
      } finally {
        if (session) {
          try {
            await session.close();
          } catch {
            failure = {
              classification: "resource_cleanup_failure",
              message: "Booking.com browser resources could not be closed.",
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
      message: "Booking.com crawl ended without a result.",
    };
    return { success: false, reviews: [], diagnostics };
  }
}
